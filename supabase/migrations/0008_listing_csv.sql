-- 0008 · Shopify product CSV generator (batch listing tool for Atiq and Sabuj)
-- Batches of competitor links -> one Shopify import CSV per batch.
-- Only the team-api edge function (service connection) reads or writes these tables; RLS is on with no policies.

create extension if not exists pg_trgm with schema extensions;

-- Shopify Standard Product Taxonomy (loaded from github.com/Shopify/product-taxonomy dist/en/categories.txt)
create table if not exists public.shopify_categories (
  id    text primary key,            -- short id, e.g. aa-1-4
  path  text not null,               -- Apparel & Accessories > Clothing > Dresses
  leaf  text not null,
  depth smallint not null,
  fts   tsvector generated always as (to_tsvector('english', path)) stored
);
create index if not exists shopify_categories_fts on public.shopify_categories using gin (fts);
create index if not exists shopify_categories_leaf_trgm on public.shopify_categories using gin (leaf extensions.gin_trgm_ops);
alter table public.shopify_categories enable row level security;

-- best candidate categories for a product (full-text on words, plus fuzzy match on the leaf name)
create or replace function public.category_candidates(q text, n int default 40)
returns table (id text, path text) language sql stable set search_path = public, extensions as $$
  with words as (
    select string_agg(w, ' | ') tq from (
      select distinct w from regexp_split_to_table(lower(regexp_replace(q, '[^a-zA-Z ]', ' ', 'g')), '\s+') w
      where length(w) > 2 and w not in ('the','and','with','for','women','womens','men','mens','new','set','pcs','piece')
    ) x
  ), ft as (
    select c.id, c.path, ts_rank(c.fts, to_tsquery('english', (select tq from words))) + 0.02 * c.depth r
    from public.shopify_categories c, words
    where words.tq is not null and c.fts @@ to_tsquery('english', words.tq)
    order by r desc limit n
  ), tg as (
    select c.id, c.path, extensions.word_similarity(c.leaf, q) r
    from public.shopify_categories c order by r desc limit 15
  )
  select id, path from (select id, path, max(r) r from (select * from ft union all select * from tg) u group by id, path) z
  order by r desc limit n;
$$;
revoke all on function public.category_candidates(text, int) from public, anon, authenticated;

create table if not exists public.listing_batches (
  id          bigint generated always as identity primary key,
  employee_id uuid not null references public.employees(id),
  store       text not null,          -- vendor name, e.g. DRUHNN
  language    text not null,
  currency    text not null,
  notes       text,
  status      text not null default 'running' check (status in ('running', 'done')),
  fx          jsonb,                  -- exchange rates used, with date and source
  csv         text,
  report      jsonb,
  products    int not null default 0, -- products in the finished CSV
  tokens_in   int not null default 0,
  tokens_out  int not null default 0,
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists listing_batches_recent on public.listing_batches (created_at desc);
alter table public.listing_batches enable row level security;

create table if not exists public.listing_batch_items (
  id         bigint generated always as identity primary key,
  batch_id   bigint not null references public.listing_batches(id) on delete cascade,
  pos        int not null,
  url        text not null,
  status     text not null default 'pending' check (status in ('pending', 'working', 'done', 'failed')),
  source     jsonb,                   -- what was read from the competitor page
  output     jsonb,                   -- finished product (title, html, variants, prices, flags)
  error      text,
  tokens_in  int,
  tokens_out int,
  updated_at timestamptz not null default now(),
  unique (batch_id, pos)
);
alter table public.listing_batch_items enable row level security;

insert into public.settings (scope, key, value, meaning) values
  ('store', 'csv_tool_people', '["Sabuj"]', 'Team members (besides Atiq) who can use the Shopify CSV generator'),
  ('store', 'csv_stores', '[
    {"name":"DRUHNN","language":"German","currency":"EUR"},
    {"name":"GLAMSTADT","language":"German","currency":"EUR"},
    {"name":"SOPHIE BY MAE","language":"Dutch","currency":"EUR"},
    {"name":"NORTH SOCIETY","language":"English","currency":"USD"},
    {"name":"SOPHIA FASHION","language":"English","currency":"USD"},
    {"name":"MAISON AVERY","language":"English","currency":"USD"},
    {"name":"ELLE LANE","language":"English","currency":"USD"},
    {"name":"NORA MONROE","language":"English","currency":"USD"},
    {"name":"STELLA CAROLINA","language":"English","currency":"USD"},
    {"name":"ROSE MALIBU","language":"English","currency":"USD"},
    {"name":"AUSSIE FASHION","language":"English","currency":"AUD"},
    {"name":"CILVELLA","language":"English","currency":"USD"}
  ]', 'Stores in the Shopify CSV generator: vendor name, copy language, price currency'),
  ('store', 'csv_batch_max', '30', 'Most competitor links in one CSV batch')
on conflict (scope, key) do nothing;
