-- Enable extensions
create extension if not exists "pg_trgm";

-- Stores (must be created before users due to FK reference)
create table public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Users table (extends Supabase auth.users)
create table public.users (
  id uuid references auth.users on delete cascade primary key,
  email text not null,
  role text not null check (role in ('admin', 'seller')) default 'seller',
  display_name text not null,
  store_id uuid references public.stores(id),
  created_at timestamptz not null default now()
);

-- Categories (self-referencing for subcategories)
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  parent_id uuid references public.categories(id),
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- Products
create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  price decimal(10,2),
  cost_price decimal(10,2),
  sku text,
  barcode text,
  category_id uuid references public.categories(id),
  source text,
  source_url text,
  source_order_date date,
  status text not null check (status in ('ordered', 'received', 'damaged', 'returned', 'listed')) default 'ordered',
  quantity_on_hand int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Product images
create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) on delete cascade not null,
  url text not null,
  is_primary boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- Sales
create table public.sales (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) not null,
  store_id uuid references public.stores(id) not null,
  sold_by uuid references public.users(id) not null,
  quantity int not null check (quantity > 0),
  sale_price decimal(10,2) not null,
  sale_date date not null default current_date,
  notes text,
  created_at timestamptz not null default now()
);

-- Indexes
create index idx_products_category on public.products(category_id);
create index idx_products_status on public.products(status);
create index idx_products_name on public.products using gin (name gin_trgm_ops);
create index idx_sales_store_date on public.sales(store_id, sale_date);
create index idx_sales_product on public.sales(product_id);
create index idx_sales_date on public.sales(sale_date);
create index idx_product_images_product on public.product_images(product_id);

-- Trigger for updated_at
create function public.set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

create trigger products_updated_at before update on public.products
  for each row execute function public.set_updated_at();

-- RLS: Enable on all tables
alter table public.users enable row level security;
alter table public.products enable row level security;
alter table public.product_images enable row level security;
alter table public.categories enable row level security;
alter table public.stores enable row level security;
alter table public.sales enable row level security;

-- RLS Policies

-- Users: admins see all, sellers see themselves
create policy "Admins see all users" on public.users
  for select using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));
create policy "Users see own record" on public.users
  for select using (id = auth.uid());

-- Products: admin full access, sellers read-only on listed products
create policy "Admins full access products" on public.products
  for all using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));
create policy "Sellers read listed products" on public.products
  for select using (status = 'listed');

-- Product Images
create policy "Admins full access images" on public.product_images
  for all using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));
create policy "Sellers read images of listed" on public.product_images
  for select using (exists (select 1 from public.products p where p.id = product_images.product_id and p.status = 'listed'));

-- Categories: admins full access, sellers read
create policy "Admins full access categories" on public.categories
  for all using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));
create policy "Sellers read categories" on public.categories
  for select using (true);

-- Stores: admins full, sellers read
create policy "Admins full access stores" on public.stores
  for all using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));
create policy "Sellers read stores" on public.stores
  for select using (true);

-- Sales: admins see all, sellers see their store's sales
create policy "Admins full access sales" on public.sales
  for all using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));
create policy "Sellers read own store sales" on public.sales
  for select using (store_id = (select store_id from public.users where id = auth.uid()));
create policy "Sellers insert own sales" on public.sales
  for insert with check (sold_by = auth.uid() and store_id = (select store_id from public.users where id = auth.uid()));

-- Auto-create user profile on signup
create function public.handle_new_user() returns trigger as $$
begin
  insert into public.users (id, email, display_name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'display_name', new.email), 'seller');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
