-- 0012 · Ticket requests need Atiq's approval (21 Nov 2026)
-- Flow: support agent asks for N tickets -> status 'New' (waiting for Atiq)
--   -> Atiq approves (any number) -> 'Approved' -> the "Peptonix ticket split" task fills it -> 'Done'
--   -> or Atiq rejects -> 'Rejected'.
-- Presets: "approve every request on <day>" (optionally capped per request) approve new requests automatically.
-- The split task keeps reading public.ticket_requests_open; it now only lists APPROVED requests, with the approved amount.

alter table public.work_events
  add column if not exists approved_amount int,
  add column if not exists decided_by uuid references public.employees(id),
  add column if not exists decided_at timestamptz;

create table if not exists public.ticket_request_presets (
  id              bigint generated always as identity primary key,
  day             date not null,
  max_per_request int check (max_per_request is null or max_per_request between 1 and 200),
  note            text,
  active          boolean not null default true,
  created_by      uuid references public.employees(id),
  created_at      timestamptz not null default now()
);
alter table public.ticket_request_presets enable row level security;
create policy "admins: all" on public.ticket_request_presets for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create index if not exists ticket_request_presets_day on public.ticket_request_presets (day) where active;

-- how many tickets are open / unassigned in Commslayer, written by the scheduled tasks (the app cannot reach Commslayer itself)
create table if not exists public.inbox_snapshots (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  open_total int not null,
  unassigned int not null,
  source     text
);
alter table public.inbox_snapshots enable row level security;
create policy "admins: all" on public.inbox_snapshots for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

create or replace function public.set_inbox_snapshot(p_open int, p_unassigned int, p_source text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.inbox_snapshots (open_total, unassigned, source) values (greatest(p_open, 0), greatest(p_unassigned, 0), left(p_source, 40));
  return true;
end $$;
revoke all on function public.set_inbox_snapshot(int, int, text) from public, anon, authenticated;

-- presets approve new requests as they come in
create or replace function private.ticket_request_preset() returns trigger
language plpgsql security definer set search_path = '' as $$
declare p record;
begin
  if new.event <> 'request_tickets' or coalesce(new.status, 'New') <> 'New' then return new; end if;
  select * into p from public.ticket_request_presets
   where active and day = (coalesce(new.at, now()) at time zone 'Asia/Dhaka')::date order by id desc limit 1;
  if found then
    new.status := 'Approved';
    new.approved_amount := least(new.amount, coalesce(p.max_per_request, new.amount));
    new.decided_by := p.created_by;
    new.decided_at := now();
    new.note := left('Auto-approved by preset' || coalesce(' (' || p.note || ')', ''), 200);
  end if;
  return new;
end $$;
drop trigger if exists work_events_ticket_preset on public.work_events;
create trigger work_events_ticket_preset before insert on public.work_events
  for each row execute function private.ticket_request_preset();

-- the split task only sees approved requests, with the approved amount
create or replace view public.ticket_requests_open with (security_invoker = true) as
  select w.id, e.display_name as name, coalesce(w.approved_amount, w.amount) as amount, to_char(w.at at time zone 'Asia/Dhaka', 'HH24:MI') as asked_at
  from public.work_events w join public.employees e on e.id = w.employee_id
  where w.event = 'request_tickets' and w.status = 'Approved'
    and w.at >= ((now() at time zone 'Asia/Dhaka')::date)::timestamp at time zone 'Asia/Dhaka'
  order by w.at;
revoke all on public.ticket_requests_open from anon, authenticated;

create or replace function public.close_ticket_request(request_id bigint, note_text text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update public.work_events set status = 'Done', note = left(note_text, 200)
  where id = request_id and event = 'request_tickets' and coalesce(status, 'New') in ('New', 'Approved');
  return found;
end $$;
revoke all on function public.close_ticket_request(bigint, text) from public, anon, authenticated;
