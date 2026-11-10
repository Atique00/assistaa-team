-- =====================================================================
-- 0007 · automatic fines and scores, ticket split, admin helpers
-- Fines rows written here carry ref 'auto:<rule>' and are recomputed every
-- hour (idempotent). Fines Atiq waives stay waived. Manual fines: ref 'manual:<kind>'.
-- =====================================================================

-- ---------- rule amounts (editable from the Admin screen) ----------
insert into public.settings (scope, key, value, meaning) values
 ('support','start_grace_min', '15', 'Start report counts as on time up to this many minutes after work_start'),
 ('support','missed_report_fine_tickets', '0', 'Tickets fined for each missed start or end report (0 = no fine)'),
 ('support','break_allowed_min', '60', 'Break length allowed per day (minutes)'),
 ('support','break_fine_after_min', '65', 'Fine starts after this many break minutes'),
 ('support','break_fine_per_min', '1', 'Tickets fined per minute over'),
 ('support','break_fine_max', '20', 'Most tickets fined for one long break'),
 ('support','wait20_fine', '10', 'Tickets fined when a ticket waits 20 h'),
 ('support','wait24_fine', '40', 'Extra tickets fined when it reaches 24 h'),
 ('support','wait_fine_per_hour_after24', '10', 'Extra tickets per hour after 24 h'),
 ('support','wait_fine_max_per_ticket', '100', 'Most tickets fined for one waiting ticket'),
 ('store','start_grace_min', '15', 'Start update counts as on time up to this many minutes after work_start'),
 ('store','client_wait_minutes', '15', 'Glenn/Dion must get a reply within this many minutes in work hours')
on conflict (scope, key) do nothing;
-- ticket_value_tk, daily_fine_cap_tickets (support) and missed_update_fine_tk, client_wait_fine_tk (store) exist since 0001.

create or replace function private.num(p_scope text, p_key text, p_default numeric) returns numeric
language sql stable set search_path = '' as $$
  select coalesce((select nullif(trim(both '"' from value::text), '')::numeric from public.settings where scope = p_scope and key = p_key), p_default)
$$;

-- ---------- ticket waiting history (for 20 h fines) ----------
create table if not exists public.ticket_wait_log (
  day         date not null,
  ticket_no   text not null,
  employee_id uuid references public.employees(id),
  max_hours   numeric not null,
  first_seen  timestamptz not null default now(),
  primary key (day, ticket_no)
);
alter table public.ticket_wait_log enable row level security;
create policy "admins: all" on public.ticket_wait_log for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create index if not exists ticket_wait_log_emp on public.ticket_wait_log (employee_id, day);

create or replace function public.set_tickets_waiting(rows jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare n int := 0; v_now timestamp := now() at time zone 'Asia/Dhaka'; v_dow int; v_paused boolean;
begin
  delete from public.tickets_waiting;
  insert into public.tickets_waiting (ticket_no, employee_id, hours, link)
  select r->>'ticket', e.id, (r->>'hours')::numeric, nullif(r->>'link', '')
  from jsonb_array_elements(coalesce(rows, '[]'::jsonb)) r
  left join public.employees e on e.display_name = r->>'name';
  get diagnostics n = row_count;
  -- backlog clock is paused from Thursday 22:00 until Saturday 16:00 (start + 6 h); Friday is the day off
  v_dow := extract(isodow from v_now);
  v_paused := v_dow = 5 or (v_dow = 4 and v_now::time >= '22:00') or (v_dow = 6 and v_now::time < '16:00');
  if not v_paused then
    insert into public.ticket_wait_log (day, ticket_no, employee_id, max_hours)
    select v_now::date, t.ticket_no, t.employee_id, t.hours from public.tickets_waiting t where t.employee_id is not null
    on conflict (day, ticket_no) do update set max_hours = greatest(public.ticket_wait_log.max_hours, excluded.max_hours), employee_id = excluded.employee_id;
  end if;
  return n;
end $$;
revoke all on function public.set_tickets_waiting(jsonb) from public, anon, authenticated;

-- ---------- ticket split ----------
alter table public.ticket_splits add column if not exists dipon_tickets int not null default 0;
update public.ticket_splits set shares = shares - 'Dipon' where shares ? 'Dipon';

create or replace view public.current_split with (security_invoker = true) as
  select s.from_date, s.shares, s.dipon_tickets, s.note
  from public.ticket_splits s
  where s.from_date <= (now() at time zone 'Asia/Dhaka')::date
  order by s.from_date desc, s.id desc limit 1;
revoke all on public.current_split from anon, authenticated;

create table if not exists public.ticket_assign_log (
  id          bigint generated always as identity primary key,
  day         date not null default (now() at time zone 'Asia/Dhaka')::date,
  ticket_no   text not null,
  employee_id uuid references public.employees(id),
  run         text,
  assigned_at timestamptz not null default now()
);
alter table public.ticket_assign_log enable row level security;
create policy "admins: all" on public.ticket_assign_log for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create index if not exists ticket_assign_log_day on public.ticket_assign_log (day, employee_id);

-- rows = [{"ticket":"57801","name":"Rifat"}, ...]
create or replace function public.log_ticket_assignments(rows jsonb, run_label text) returns int
language plpgsql security definer set search_path = '' as $$
declare n int := 0;
begin
  insert into public.ticket_assign_log (ticket_no, employee_id, run)
  select r->>'ticket', e.id, left(run_label, 40)
  from jsonb_array_elements(coalesce(rows, '[]'::jsonb)) r
  join public.employees e on e.display_name = r->>'name';
  get diagnostics n = row_count;
  return n;
end $$;

create or replace view public.ticket_requests_open with (security_invoker = true) as
  select w.id, e.display_name as name, w.amount, to_char(w.at at time zone 'Asia/Dhaka', 'HH24:MI') as asked_at
  from public.work_events w join public.employees e on e.id = w.employee_id
  where w.event = 'request_tickets' and coalesce(w.status, 'New') = 'New'
    and w.at >= ((now() at time zone 'Asia/Dhaka')::date)::timestamp at time zone 'Asia/Dhaka'
  order by w.at;
revoke all on public.ticket_requests_open from anon, authenticated;

create or replace function public.close_ticket_request(request_id bigint, note_text text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update public.work_events set status = 'Done', note = left(note_text, 200)
  where id = request_id and event = 'request_tickets' and coalesce(status, 'New') = 'New';
  return found;
end $$;

-- ---------- client-wait fines (store), written by the 3-hourly task ----------
-- one call per late Glenn/Dion message; fines every store member working that day; safe to repeat
create or replace function public.add_client_wait_fine(p_day date, message_ref text, minutes_waited int, summary text) returns int
language plpgsql security definer set search_path = '' as $$
declare n int := 0; v_amt numeric := private.num('store', 'client_wait_fine_tk', 50);
begin
  if minutes_waited < private.num('store', 'client_wait_minutes', 15) then return 0; end if;
  insert into public.fines (day, employee_id, rule, ref, amount, unit, note)
  select p_day, e.id, 'Client not answered within 15 min', 'auto:client_wait:' || left(message_ref, 80), v_amt, 'bdt',
         left(coalesce(summary, ''), 200) || ' (' || minutes_waited || ' min)'
  from public.employees e join public.teams t on t.id = e.team_id and t.key = 'store'
  where e.active
    and exists (select 1 from public.work_events w where w.employee_id = e.id and w.event = 'start'
                and (w.at at time zone 'Asia/Dhaka')::date = p_day)
    and not exists (select 1 from public.fines f where f.employee_id = e.id and f.ref = 'auto:client_wait:' || left(message_ref, 80));
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- daily fines ----------
create or replace function public.run_daily_fines(p_day date) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamp := now() at time zone 'Asia/Dhaka';
  v_today date := (now() at time zone 'Asia/Dhaka')::date;
  v_workday boolean := extract(isodow from p_day) <> 5 and not exists (select 1 from public.holidays h where h.day = p_day);
  v_start_check boolean := p_day < v_today or v_now::time >= '12:00';
  v_end_check boolean := p_day < v_today or v_now::time >= '23:00';
  e record; v_team text; v_leave boolean; v_amt numeric; v_unit text; v_mins numeric; v_over numeric;
  w record; v_due numeric; v_before numeric; v_total numeric; v_cap numeric; n int := 0;
begin
  if p_day > v_today then return 0; end if;
  -- recompute: drop this day's automatic fines that are still active (waived ones stay)
  delete from public.fines f where f.day = p_day and f.status = 'active' and f.ref like 'auto:%' and f.ref not like 'auto:client_wait:%';

  for e in select emp.id, emp.display_name, t.key as team from public.employees emp join public.teams t on t.id = emp.team_id where emp.active loop
    v_team := e.team;
    v_leave := exists (select 1 from public.leave_requests l where l.employee_id = e.id and l.state = 'approved' and p_day between l.starts_on and l.ends_on);
    v_unit := case when v_team = 'support' then 'tickets' else 'bdt' end;
    v_amt := case when v_team = 'support' then private.num('support', 'missed_report_fine_tickets', 0) else private.num('store', 'missed_update_fine_tk', 50) end;

    if v_workday and not v_leave and v_amt > 0 then
      if v_start_check and not exists (select 1 from public.reports r where r.employee_id = e.id and r.kind = 'Start report' and (r.created_at at time zone 'Asia/Dhaka')::date = p_day) then
        insert into public.fines (day, employee_id, rule, ref, amount, unit)
        select p_day, e.id, 'Missed start update', 'auto:missed_start', v_amt, v_unit
        where not exists (select 1 from public.fines f where f.day = p_day and f.employee_id = e.id and f.ref = 'auto:missed_start');
        n := n + 1;
      end if;
      if v_end_check and not exists (select 1 from public.reports r where r.employee_id = e.id and r.kind = 'End report' and (r.created_at at time zone 'Asia/Dhaka')::date = p_day) then
        insert into public.fines (day, employee_id, rule, ref, amount, unit)
        select p_day, e.id, 'Missed end update', 'auto:missed_end', v_amt, v_unit
        where not exists (select 1 from public.fines f where f.day = p_day and f.employee_id = e.id and f.ref = 'auto:missed_end');
        n := n + 1;
      end if;
    end if;

    if v_team = 'support' and v_workday and not v_leave then
      -- long break: minutes between each break_start and the next break_end (or done / now)
      select coalesce(sum(extract(epoch from (coalesce(
               (select min(x.at) from public.work_events x where x.employee_id = e.id and x.at > b.at and x.event in ('break_end','done')),
               case when p_day < v_today then null else now() end) - b.at)) / 60), 0)
        into v_mins
      from public.work_events b
      where b.employee_id = e.id and b.event = 'break_start' and (b.at at time zone 'Asia/Dhaka')::date = p_day;
      v_over := floor(v_mins - private.num('support', 'break_fine_after_min', 65));
      if v_over > 0 then
        insert into public.fines (day, employee_id, rule, ref, amount, unit, note)
        select p_day, e.id, 'Break longer than allowed', 'auto:break',
               least(private.num('support', 'break_fine_max', 20), v_over * private.num('support', 'break_fine_per_min', 1)), 'tickets',
               round(v_mins) || ' min break'
        where not exists (select 1 from public.fines f where f.day = p_day and f.employee_id = e.id and f.ref = 'auto:break');
        n := n + 1;
      end if;

      -- tickets waiting 20 h+: total due per ticket, minus what earlier days already fined, capped per ticket
      for w in select l.ticket_no, l.max_hours from public.ticket_wait_log l where l.day = p_day and l.employee_id = e.id loop
        v_due := case when w.max_hours < 20 then 0
                      when w.max_hours < 24 then private.num('support', 'wait20_fine', 10)
                      else private.num('support', 'wait20_fine', 10) + private.num('support', 'wait24_fine', 40)
                           + private.num('support', 'wait_fine_per_hour_after24', 10) * floor(w.max_hours - 24) end;
        v_due := least(v_due, private.num('support', 'wait_fine_max_per_ticket', 100));
        select coalesce(sum(f.amount), 0) into v_before from public.fines f
          where f.employee_id = e.id and f.ref = 'auto:wait:' || w.ticket_no and f.day <> p_day;
        if v_due - v_before > 0 then
          insert into public.fines (day, employee_id, rule, ref, amount, unit, note)
          select p_day, e.id, 'Ticket #' || w.ticket_no || ' waited ' || floor(w.max_hours) || ' h', 'auto:wait:' || w.ticket_no, v_due - v_before, 'tickets', null
          where not exists (select 1 from public.fines f where f.day = p_day and f.employee_id = e.id and f.ref = 'auto:wait:' || w.ticket_no);
          n := n + 1;
        end if;
      end loop;

      -- daily cap
      v_cap := private.num('support', 'daily_fine_cap_tickets', 200);
      select coalesce(sum(f.amount), 0) into v_total from public.fines f where f.day = p_day and f.employee_id = e.id and f.status = 'active' and f.unit = 'tickets';
      if v_total > v_cap then
        insert into public.fines (day, employee_id, rule, ref, amount, unit, note)
        values (p_day, e.id, 'Daily cap (' || v_cap || ' tickets)', 'auto:cap', v_cap - v_total, 'tickets', 'Fines above the cap are not charged');
      end if;
    end if;
  end loop;
  return n;
end $$;

-- ---------- daily scores (0–10) ----------
create or replace function public.run_daily_scores(p_day date) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Asia/Dhaka')::date;
  v_final boolean := p_day < v_today or (now() at time zone 'Asia/Dhaka')::time >= '22:00';
  v_workday boolean := extract(isodow from p_day) <> 5 and not exists (select 1 from public.holidays h where h.day = p_day);
  e record; v_start timestamptz; v_end boolean; v_on_time timestamptz; v_why text[]; v_parts jsonb; v_score numeric;
  a numeric; b numeric; c numeric; d numeric; f numeric; v_avg numeric; v_msgs numeric; v_wait numeric; v_cnt int; n int := 0;
begin
  if not v_final or not v_workday then return 0; end if;
  select avg(s.value) into v_avg from public.daily_stats s join public.employees x on x.id = s.employee_id
   where s.day = p_day and s.metric = 'messages_sent' and s.value > 0 and coalesce(x.rate_per_unit, 0) > 0;

  for e in select emp.id, emp.display_name, emp.rate_per_unit, t.key as team from public.employees emp join public.teams t on t.id = emp.team_id where emp.active loop
    if exists (select 1 from public.leave_requests l where l.employee_id = e.id and l.state = 'approved' and p_day between l.starts_on and l.ends_on) then continue; end if;
    v_why := '{}';
    select min(r.created_at) into v_start from public.reports r where r.employee_id = e.id and r.kind = 'Start report' and (r.created_at at time zone 'Asia/Dhaka')::date = p_day;
    v_end := exists (select 1 from public.reports r where r.employee_id = e.id and r.kind = 'End report' and (r.created_at at time zone 'Asia/Dhaka')::date = p_day);
    v_on_time := ((p_day + time '10:00')::timestamp + make_interval(mins => private.num(e.team, 'start_grace_min', 15)::int)) at time zone 'Asia/Dhaka';

    if e.team = 'support' then
      select coalesce(max(s.value), 0) into v_wait from public.daily_stats s where s.employee_id = e.id and s.day = p_day and s.metric = 'waiting_20h';
      a := greatest(0, 3 - v_wait);                                         -- speed /3
      if v_wait > 0 then v_why := v_why || (v_wait || ' ticket(s) waited 20 h+'); end if;
      b := case when v_start is null then 0 when v_start <= v_on_time then 1 else 0.5 end + case when v_end then 1 else 0 end;   -- activity /2
      if v_start is null then v_why := v_why || 'no start report'::text; elsif v_start > v_on_time then v_why := v_why || 'late start'::text; end if;
      if not v_end then v_why := v_why || 'no end report'::text; end if;
      select coalesce(max(s.value), 0) into v_msgs from public.daily_stats s where s.employee_id = e.id and s.day = p_day and s.metric = 'messages_sent';
      c := case when coalesce(e.rate_per_unit, 0) = 0 or coalesce(v_avg, 0) = 0 then 2
                when v_msgs >= 0.9 * v_avg then 2 when v_msgs >= 0.6 * v_avg then 1 else 0 end;   -- output /2
      if c < 2 then v_why := v_why || ('messages ' || round(v_msgs) || ' vs team avg ' || round(v_avg)); end if;
      select count(*) into v_cnt from public.fines x where x.employee_id = e.id and x.day = p_day and x.status = 'active' and x.ref like 'manual:quality%';
      d := greatest(0, 2 - v_cnt);                                          -- quality /2
      if v_cnt > 0 then v_why := v_why || (v_cnt || ' quality fine(s)'); end if;
      select count(*) into v_cnt from public.fines x where x.employee_id = e.id and x.day = p_day and x.status = 'active'
        and x.amount > 0 and x.ref not like 'auto:wait:%' and x.ref not like 'manual:quality%';
      f := case when v_cnt = 0 then 1 else 0 end;                           -- discipline /1
      if v_cnt > 0 then v_why := v_why || 'discipline fine'::text; end if;
      v_parts := jsonb_build_object('speed', a, 'activity', b, 'output', c, 'quality', d, 'discipline', f);
      v_score := a + b + c + d + f;
    else
      a := case when v_start is null then 0 when v_start <= v_on_time then 2 else 1 end + case when v_end then 2 else 0 end;   -- updates /4
      if v_start is null then v_why := v_why || 'no start update'::text; elsif v_start > v_on_time then v_why := v_why || 'late start update'::text; end if;
      if not v_end then v_why := v_why || 'no end update'::text; end if;
      select count(*) into v_cnt from public.fines x where x.employee_id = e.id and x.day = p_day and x.status = 'active' and x.ref like 'auto:client_wait:%';
      b := greatest(0, 4 - 2 * v_cnt);                                      -- client replies /4
      if v_cnt > 0 then v_why := v_why || (v_cnt || ' late client reply(s)'); end if;
      select count(*) into v_cnt from public.tasks t join public.task_assignments ta on ta.task_id = t.id and ta.ended_at is null
        where ta.employee_id = e.id and t.status not in ('completed','cancelled') and t.due_at < ((p_day + 1)::timestamp at time zone 'Asia/Dhaka');
      c := greatest(0, 2 - v_cnt);                                          -- tasks /2
      if v_cnt > 0 then v_why := v_why || (v_cnt || ' overdue task(s)'); end if;
      v_parts := jsonb_build_object('updates', a, 'client_replies', b, 'tasks', c);
      v_score := a + b + c;
    end if;

    insert into public.scores (day, employee_id, score, parts, why)
    values (p_day, e.id, v_score, v_parts, nullif(array_to_string(v_why, ', '), ''))
    on conflict (day, employee_id) do update set score = excluded.score, parts = excluded.parts, why = excluded.why;
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.run_daily_fines(date) from public, anon, authenticated;
revoke all on function public.run_daily_scores(date) from public, anon, authenticated;
revoke all on function public.add_client_wait_fine(date, text, int, text) from public, anon, authenticated;
revoke all on function public.log_ticket_assignments(jsonb, text) from public, anon, authenticated;
revoke all on function public.close_ticket_request(bigint, text) from public, anon, authenticated;
revoke all on function private.num(text, text, numeric) from public, anon, authenticated;

-- ---------- run every hour (and once more for yesterday after midnight) ----------
create extension if not exists pg_cron;
select cron.schedule('fines-scores-today', '50 * * * *',
  $$select public.run_daily_fines((now() at time zone 'Asia/Dhaka')::date), public.run_daily_scores((now() at time zone 'Asia/Dhaka')::date)$$);
select cron.schedule('fines-scores-yesterday', '10 19 * * *',
  $$select public.run_daily_fines((now() at time zone 'Asia/Dhaka')::date - 1), public.run_daily_scores((now() at time zone 'Asia/Dhaka')::date - 1)$$);
