-- AK 3D Supabase schema
create extension if not exists pgcrypto;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_no text,
  project_name text,
  global_units integer default 0,
  status text default 'Tilbud',
  priority text default 'Normal',
  start_date date,
  deadline date,
  tags text,
  notes text,
  customer_name text,
  total_inc numeric default 0,
  payload jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete cascade,
  name text not null,
  weight_plate_g numeric default 0,
  filament text,
  pieces_per_plate integer default 1,
  mult_per_unit integer default 1,
  plate_hours numeric default 0,
  plate_minutes numeric default 0,
  status text default 'Planlagt',
  payload jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create table if not exists public.plate_status (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete cascade,
  plate_key text not null,
  plate_no integer,
  item_name text,
  done boolean default false,
  updated_at timestamptz default now(),
  unique(order_id, plate_key)
);

create table if not exists public.filament (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price numeric default 0,
  stock_kg numeric default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.inventory (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  unit text default 'stk',
  price numeric default 0,
  qty_per_unit numeric default 1,
  stock numeric default 0,
  min_stock numeric default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.printers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  watt numeric default 120,
  hours_per_day numeric default 16,
  status text default 'Aktiv',
  endpoint text,
  plug_type text,
  service_note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  addr1 text,
  addr2 text,
  cvr text,
  email text,
  phone text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.plate_status enable row level security;
alter table public.filament enable row level security;
alter table public.inventory enable row level security;
alter table public.printers enable row level security;
alter table public.customers enable row level security;

-- Midlertidige test policies.
-- Når login kommer på, strammer vi dem op.
create policy "orders_all_test" on public.orders for all using (true) with check (true);
create policy "order_items_all_test" on public.order_items for all using (true) with check (true);
create policy "plate_status_all_test" on public.plate_status for all using (true) with check (true);
create policy "filament_all_test" on public.filament for all using (true) with check (true);
create policy "inventory_all_test" on public.inventory for all using (true) with check (true);
create policy "printers_all_test" on public.printers for all using (true) with check (true);
create policy "customers_all_test" on public.customers for all using (true) with check (true);
