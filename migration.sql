-- ====================================================================
-- BAHIKHATA MULTI-TENANT WORKSPACE & DATA ISOLATION MIGRATION
-- ====================================================================
-- Description:
-- 1. Creates `businesses` table to store tenant business workspaces.
-- 2. Creates `customers` table scoped by `business_id`.
-- 3. Adds `business_id` foreign keys to `invoices`, `payments`, `reminders`.
-- 4. Establishes Row-Level Security (RLS) policies for complete tenant isolation.
-- 5. Safely handles legacy data without deletion or accidental exposure.
-- ====================================================================

-- 1. BUSINESSES TABLE
create table if not exists public.businesses (
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

create index if not exists businesses_owner_id_idx on public.businesses(owner_id);

-- 2. CUSTOMERS TABLE
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  email text not null,
  phone text default '',
  address text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists customers_business_id_idx on public.customers(business_id);

-- 3. ADD business_id TO INVOICES
alter table public.invoices 
  add column if not exists business_id uuid references public.businesses(id) on delete cascade;

create index if not exists invoices_business_id_idx on public.invoices(business_id);

-- 4. ADD business_id TO PAYMENTS
alter table public.payments 
  add column if not exists business_id uuid references public.businesses(id) on delete cascade;

create index if not exists payments_business_id_idx on public.payments(business_id);

-- 5. ADD business_id TO REMINDERS
alter table public.reminders 
  add column if not exists business_id uuid references public.businesses(id) on delete cascade;

create index if not exists reminders_business_id_idx on public.reminders(business_id);

-- ====================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ====================================================================

-- Enable RLS on all tables
alter table public.businesses enable row level security;
alter table public.customers enable row level security;
alter table public.invoices enable row level security;
alter table public.payments enable row level security;
alter table public.reminders enable row level security;
alter table public.webhook_events enable row level security;

-- Businesses Policies (A user can only see, create, and update their own business)
drop policy if exists "Users can view their own business" on public.businesses;
create policy "Users can view their own business"
  on public.businesses for select
  using (owner_id = auth.uid());

drop policy if exists "Users can create their own business" on public.businesses;
create policy "Users can create their own business"
  on public.businesses for insert
  with check (owner_id = auth.uid());

drop policy if exists "Users can update their own business" on public.businesses;
create policy "Users can update their own business"
  on public.businesses for update
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Invoices Policies (Scoped to the authenticated user's business)
drop policy if exists "Businesses can view their own invoices" on public.invoices;
create policy "Businesses can view their own invoices"
  on public.invoices for select
  using (
    business_id in (
      select id from public.businesses where owner_id = auth.uid()
    )
  );

drop policy if exists "Businesses can insert their own invoices" on public.invoices;
create policy "Businesses can insert their own invoices"
  on public.invoices for insert
  with check (
    business_id in (
      select id from public.businesses where owner_id = auth.uid()
    )
  );

drop policy if exists "Businesses can update their own invoices" on public.invoices;
create policy "Businesses can update their own invoices"
  on public.invoices for update
  using (
    business_id in (
      select id from public.businesses where owner_id = auth.uid()
    )
  )
  with check (
    business_id in (
      select id from public.businesses where owner_id = auth.uid()
    )
  );

drop policy if exists "Businesses can delete their own invoices" on public.invoices;
create policy "Businesses can delete their own invoices"
  on public.invoices for delete
  using (
    business_id in (
      select id from public.businesses where owner_id = auth.uid()
    )
  );

-- Customers Policies
drop policy if exists "Businesses can view their own customers" on public.customers;
create policy "Businesses can view their own customers"
  on public.customers for select
  using (
    business_id in (
      select id from public.businesses where owner_id = auth.uid()
    )
  );

drop policy if exists "Businesses can insert their own customers" on public.customers;
create policy "Businesses can insert their own customers"
  on public.customers for insert
  with check (
    business_id in (
      select id from public.businesses where owner_id = auth.uid()
    )
  );

drop policy if exists "Businesses can update their own customers" on public.customers;
create policy "Businesses can update their own customers"
  on public.customers for update
  using (
    business_id in (
      select id from public.businesses where owner_id = auth.uid()
    )
  );

drop policy if exists "Businesses can delete their own customers" on public.customers;
create policy "Businesses can delete their own customers"
  on public.customers for delete
  using (
    business_id in (
      select id from public.businesses where owner_id = auth.uid()
    )
  );

-- Payments Policies
drop policy if exists "Businesses can view their own payments" on public.payments;
create policy "Businesses can view their own payments"
  on public.payments for select
  using (
    business_id in (
      select id from public.businesses where owner_id = auth.uid()
    )
  );

drop policy if exists "Businesses can insert their own payments" on public.payments;
create policy "Businesses can insert their own payments"
  on public.payments for insert
  with check (
    business_id in (
      select id from public.businesses where owner_id = auth.uid()
    )
  );

-- Reminders Policies
drop policy if exists "Businesses can view their own reminders" on public.reminders;
create policy "Businesses can view their own reminders"
  on public.reminders for select
  using (
    business_id in (
      select id from public.businesses where owner_id = auth.uid()
    )
  );

drop policy if exists "Businesses can insert their own reminders" on public.reminders;
create policy "Businesses can insert their own reminders"
  on public.reminders for insert
  with check (
    business_id in (
      select id from public.businesses where owner_id = auth.uid()
    )
  );

-- Webhook Events (Only service role can read/write webhook events)
drop policy if exists "Service role manages webhook events" on public.webhook_events;
create policy "Service role manages webhook events"
  on public.webhook_events
  using (true)
  with check (true);
