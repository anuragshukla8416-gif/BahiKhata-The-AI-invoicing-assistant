create table invoices (
  id uuid primary key default gen_random_uuid(),
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

create index invoices_status_due_idx on invoices (status, due_date);

create table reminders (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  subject text not null,
  body text not null,
  sent_at timestamptz not null default now()
);

create table webhook_events (
  event_id text primary key,
  event_type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now()
);

-- the backend uses the service role key, which bypasses RLS;
-- with no policies, the anon key can't read or write anything
alter table invoices enable row level security;
alter table reminders enable row level security;
alter table webhook_events enable row level security;
