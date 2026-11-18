-- 0010 · each store has its own Shopify app (custom distribution = one store per app): client id + secret per store
alter table public.shop_connections add column if not exists client_id text;
alter table public.shop_connections add column if not exists secret_id uuid; -- vault: app client secret

create or replace function public.shop_secret_put(p_store text, p_kind text, p_value text) returns void
language plpgsql security definer set search_path = public, vault as $$
declare sid uuid;
begin
  if p_kind = 'token' then select token_secret into sid from public.shop_connections where store = p_store;
  else select secret_id into sid from public.shop_connections where store = p_store; end if;
  if sid is null then
    sid := vault.create_secret(p_value, 'shopify-' || p_kind || '-' || lower(regexp_replace(p_store, '\W+', '-', 'g')) || '-' || substr(md5(random()::text), 1, 6));
    if p_kind = 'token' then update public.shop_connections set token_secret = sid where store = p_store;
    else update public.shop_connections set secret_id = sid where store = p_store; end if;
  else
    perform vault.update_secret(sid, p_value);
  end if;
end $$;

create or replace function public.shop_secret_get(p_store text, p_kind text) returns text
language sql security definer set search_path = public, vault as $$
  select s.decrypted_secret from public.shop_connections c
  join vault.decrypted_secrets s on s.id = case when p_kind = 'token' then c.token_secret else c.secret_id end
  where c.store = p_store;
$$;
drop function if exists public.shop_token_set(text, text);
drop function if exists public.shop_token_get(text);
revoke all on function public.shop_secret_put(text, text, text) from public, anon, authenticated;
revoke all on function public.shop_secret_get(text, text) from public, anon, authenticated;
