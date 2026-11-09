-- ====================================================================
-- BAHIKHATA DATABASE SCHEMA (Multi-Tenant SaaS)
-- ====================================================================

-- 1. BUSINESSES TABLE
create table if not exists businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  business_name text not null,
  business_type text not null default 'Freelancer / Service Provider',
  business_email text not null,
  business_phone text default '',
  business_address text default '',
  city text default '',
  state text default '',
  postal_code text default '',
  country text not null default 'India',
  gst_registered boolean not null default false,
  gstin text,
  pan text default '',
  logo_url text,
  currency text not null default 'INR',
  tax_name text not null default 'GST',
  tax_rate numeric(5,2) not null default 18.00,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint businesses_owner_id_unique unique (owner_id)
);

create index if not exists businesses_owner_id_idx on businesses(owner_id);

-- 2. CUSTOMERS TABLE
create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  email text not null,
  phone text default '',
  address text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists customers_business_id_idx on customers(business_id);

-- 3. INVOICES TABLE
create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  paypal_invoice_id text unique not null,
  invoice_number text not null,
  client_name text not null,
  client_email text not null,
  items jsonb not null,
  currency text not null default 'USD',
  total numeric(12,2) not null,
  due_date date not null,
  notes text not null default '',
  status text not null default 'DRAFT',
  status_updated_at timestamptz,
  reminders_sent int not null default 0,
  last_reminder_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists invoices_status_due_idx on invoices (status, due_date);
create index if not exists invoices_business_id_idx on invoices (business_id);

-- 4. REMINDERS TABLE
create table if not exists reminders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  invoice_id uuid not null references invoices(id) on delete cascade,
  subject text not null,
  body text not null,
  sent_at timestamptz not null default now()
);

create index if not exists reminders_invoice_id_idx on reminders(invoice_id);
create index if not exists reminders_business_id_idx on reminders(business_id);

-- 5. WEBHOOK EVENTS TABLE
create table if not exists webhook_events (
  event_id text primary key,
  event_type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now()
);

-- 6. PAYMENTS TABLE
create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  invoice_id uuid not null references invoices(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  currency text not null,
  paypal_capture_id text unique,
  paid_at timestamptz not null default now()
);

create index if not exists payments_invoice_idx on payments (invoice_id);
create index if not exists payments_business_id_idx on payments (business_id);

-- ENABLE ROW LEVEL SECURITY
alter table businesses enable row level security;
alter table customers enable row level security;
alter table invoices enable row level security;
alter table reminders enable row level security;
alter table webhook_events enable row level security;
alter table payments enable row level security;
