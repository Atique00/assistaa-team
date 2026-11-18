-- 0009 · tools.assistaa.com: own logins, preview edits, direct upload to Shopify stores
-- Logins are Supabase Auth users (email + password) that Atiq creates; only emails in tools_members can use the tools.
-- Store access: the "Assistaa Products" Shopify app installed once per store; its token is kept in Supabase Vault.

create table if not exists public.tools_members (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text not null unique,
  name       text not null,
  role       text not null default 'member' check (role in ('owner', 'member')),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.tools_members enable row level security;

create table if not exists public.shop_connections (
  store        text primary key,            -- vendor name from store.csv_stores, e.g. DRUHNN
  shop_domain  text not null unique,        -- xxx.myshopify.com
  token_secret uuid,                        -- vault.secrets id holding the Admin API token
  scopes       text,
  status       text not null default 'pending' check (status in ('pending', 'connected', 'removed')),
  installed_at timestamptz,
  updated_at   timestamptz not null default now()
);
alter table public.shop_connections enable row level security;

-- one-time OAuth state values (install links)
create table if not exists public.shop_oauth_states (
  state      text primary key,
  store      text not null,
  shop       text not null,
  created_by uuid,
  created_at timestamptz not null default now()
);
alter table public.shop_oauth_states enable row level security;

-- batches from the tools site belong to a tools member instead of a team-app employee
alter table public.listing_batches alter column employee_id drop not null;
alter table public.listing_batches add column if not exists user_id uuid references auth.users(id);
alter table public.listing_batches add constraint listing_batches_owner check (employee_id is not null or user_id is not null) not valid;

alter table public.listing_batch_items add column if not exists edited_by uuid references auth.users(id);
alter table public.listing_batch_items add column if not exists edited_at timestamptz;
alter table public.listing_batch_items add column if not exists shopify_product_id text;
alter table public.listing_batch_items add column if not exists uploaded_at timestamptz;
alter table public.listing_batch_items add column if not exists upload_error text;

-- every write to a store, for the record
create table if not exists public.shop_actions (
  id         bigint generated always as identity primary key,
  user_id    uuid references auth.users(id),
  store      text not null,
  action     text not null check (action in ('create', 'delete')),
  product_id text,
  title      text,
  batch_id   bigint,
  ok         boolean not null,
  error      text,
  at         timestamptz not null default now()
);
alter table public.shop_actions enable row level security;

-- token helpers (service connection only)
create or replace function public.shop_token_set(p_store text, p_token text) returns void
language plpgsql security definer set search_path = public, vault as $$
declare sid uuid;
begin
  select token_secret into sid from public.shop_connections where store = p_store;
  if sid is null then
    sid := vault.create_secret(p_token, 'shopify-' || lower(p_store), 'Admin API token for ' || p_store);
    update public.shop_connections set token_secret = sid where store = p_store;
  else
    perform vault.update_secret(sid, p_token);
  end if;
end $$;
create or replace function public.shop_token_get(p_store text) returns text
language sql security definer set search_path = public, vault as $$
  select s.decrypted_secret from public.shop_connections c join vault.decrypted_secrets s on s.id = c.token_secret
  where c.store = p_store and c.status = 'connected';
$$;
revoke all on function public.shop_token_set(text, text) from public, anon, authenticated;
revoke all on function public.shop_token_get(text) from public, anon, authenticated;
