-- =====================================================================
-- Assistaa OS · migration 0001 · core schema (Phase 1)
-- Applied to Supabase project "assistaa" (zciuchdximmzwiisdkqu, Singapore).
-- Changes from docs/schema.sql draft:
--   * employees.id is its own uuid; auth_user_id links to Supabase Auth
--     (PIN login creates the auth user on first sign-in).
--   * PIN hashes live in schema "private" (not reachable through the API).
--   * Tables added to mirror today's sheets: inbox_messages, ticket_splits,
--     rules, client_messages, tickets_waiting. settings are scoped per team.
--   * RLS on every table; helpers live in "private"; owner/admin see all.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector   with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------- enums ----------------------------------------------------
create type public.app_role       as enum ('owner','admin','manager','team_lead','employee');
create type public.task_status    as enum ('pending','in_progress','under_review','revision_required','completed','cancelled','on_hold');
create type public.task_priority  as enum ('urgent','high','medium','low');
create type public.task_kind      as enum ('product_listing','product_research','customer_support','dispute_paypal','dispute_stripe','dispute_klarna','ad_creative','store_management','other');
create type public.qa_outcome     as enum ('passed','failed','requires_human_review');
create type public.ack_state      as enum ('waiting','seen','responded','not_seen','escalated');
create type public.root_cause     as enum ('unclear_instructions','knowledge_gap','miscommunication','technical_issue','individual_mistake','client_change','unknown');
create type public.leave_state    as enum ('requested','approved','declined','cancelled');
create type public.decision_state as enum ('suggested','approved','changed','rejected');

-- ---------- organisation ----------------------------------------------
create table public.departments (
  id          smallint generated always as identity primary key,
  name        text not null unique,
  created_at  timestamptz not null default now()
);

create table public.teams (
  id            smallint generated always as identity primary key,
  key           text not null unique check (key ~ '^[a-z0-9_]+$'),   -- store, support
  department_id smallint references public.departments(id),
  name          text not null unique,
  lead_id       uuid,
  created_at    timestamptz not null default now()
);

create table public.employees (
  id             uuid primary key default gen_random_uuid(),
  auth_user_id   uuid unique references auth.users(id) on delete set null,
  full_name      text not null,
  display_name   text not null,
  role           public.app_role not null default 'employee',
  team_id        smallint references public.teams(id),
  manager_id     uuid references public.employees(id),
  job_title      text,
  aliases        jsonb not null default '{}'::jsonb,   -- {"slack":"Mr. Green","commslayer":"Jessica"}
  email          text unique,
  phone          text,
  photo_path     text,
  about          text check (char_length(about) <= 300),
  skills         text[] not null default '{}',
  pay_model      text check (pay_model in ('fixed','per_message','mixed')),
  rate_per_unit  numeric(10,2),
  work_start     time not null default '10:00',
  day_off        smallint check (day_off between 0 and 6),   -- 5 = Friday
  active         boolean not null default true,
  joined_on      date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (team_id, display_name)
);
alter table public.teams add constraint teams_lead_fk foreign key (lead_id) references public.employees(id);
create index on public.employees (team_id) where active;
create index on public.employees (manager_id);

create table public.employee_skills (
  employee_id uuid references public.employees(id) on delete cascade,
  skill       text not null,
  level       smallint not null check (level between 1 and 5),
  primary key (employee_id, skill)
);

-- PIN hashes (bcrypt via pgcrypto). Never exposed through the API.
create table private.employee_pins (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  pin_hash    text not null,
  updated_at  timestamptz not null default now()
);

create table public.login_attempts (
  id          bigint generated always as identity primary key,
  employee_id uuid references public.employees(id),
  ok          boolean not null,
  at          timestamptz not null default now(),
  ip_hash     text
);
create index on public.login_attempts (at desc);
create index on public.login_attempts (employee_id, at desc);

create table public.settings (
  scope       text not null default 'global',          -- global, store, support
  key         text not null,
  value       jsonb not null,
  meaning     text,
  updated_by  uuid references public.employees(id),
  updated_at  timestamptz not null default now(),
  primary key (scope, key)
);

create table public.rules (                               -- "Rules & Fines" tab
  id          bigint generated always as identity primary key,
  team_id     smallint not null references public.teams(id),
  rule        text not null,
  fine        numeric,
  applies_to  text,
  notes       text,
  sort        int not null default 0
);

-- ---------- clients & stores -----------------------------------------
create table public.clients (
  id          bigint generated always as identity primary key,
  name        text not null unique,
  business    text,
  notes       text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table public.client_contacts (
  id          bigint generated always as identity primary key,
  client_id   bigint not null references public.clients(id) on delete cascade,
  name        text not null,
  role        text,
  email       text,
  channel     text,
  handle      text
);
create index on public.client_contacts (client_id);

create table public.client_stores (
  id             bigint generated always as identity primary key,
  client_id      bigint not null references public.clients(id) on delete cascade,
  name           text not null,
  platform       text not null default 'shopify' check (platform in ('shopify','woocommerce','other')),
  domain         text,
  secret_ref     text,                                  -- Vault secret id, never the token
  read_only      boolean not null default true,
  active         boolean not null default true,
  unique (client_id, name)
);

create table public.client_assignments (
  client_id   bigint references public.clients(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete cascade,
  since       date not null default current_date,
  primary key (client_id, employee_id)
);
create index on public.client_assignments (employee_id);

create table public.projects (
  id          bigint generated always as identity primary key,
  client_id   bigint not null references public.clients(id),
  name        text not null,
  status      text not null default 'active',
  starts_on   date,
  ends_on     date
);
create index on public.projects (client_id);

-- ---------- tasks -----------------------------------------------------
create sequence public.task_code_seq;
create table public.tasks (
  id                    bigint generated always as identity primary key,
  code                  text not null unique default ('T-' || nextval('public.task_code_seq')),
  title                 text not null check (char_length(title) <= 300),
  instructions          text,
  notes                 text,
  kind                  public.task_kind not null default 'other',
  status                public.task_status not null default 'pending',
  priority              public.task_priority not null default 'medium',
  team_id               smallint references public.teams(id),
  client_id             bigint references public.clients(id),
  store_id              bigint references public.client_stores(id),
  area                  text,                            -- free text "Store / area" from the sheet
  project_id            bigint references public.projects(id),
  qa_template_id        bigint,
  requested_by_name     text,                            -- Glenn, Dion (clients) or a person
  due_at                timestamptz,
  estimate_minutes      int check (estimate_minutes > 0),
  ack_threshold_minutes int not null default 60,
  recurrence            text,                            -- RRULE, e.g. FREQ=DAILY
  parent_recurring_id   bigint references public.tasks(id),
  created_by            uuid references public.employees(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  completed_at          timestamptz
);
create index on public.tasks (status, due_at);
create index on public.tasks (team_id, status);
create index on public.tasks (client_id, status);

create table public.task_assignments (
  id                 bigint generated always as identity primary key,
  task_id            bigint not null references public.tasks(id) on delete cascade,
  employee_id        uuid not null references public.employees(id),
  is_primary         boolean not null default true,
  assigned_by        uuid references public.employees(id),
  assigned_at        timestamptz not null default now(),
  first_seen_at      timestamptz,
  first_response_at  timestamptz,
  ack                public.ack_state not null default 'waiting',
  ended_at           timestamptz,
  unique (task_id, employee_id, assigned_at)
);
create index on public.task_assignments (employee_id) where ended_at is null;
create index on public.task_assignments (task_id);
create index on public.task_assignments (ack, assigned_at) where ack in ('waiting','not_seen');

create table public.task_followups (
  id              bigint generated always as identity primary key,
  assignment_id   bigint not null references public.task_assignments(id) on delete cascade,
  follower_id     uuid not null references public.employees(id),
  requested_by    uuid not null references public.employees(id),
  requested_at    timestamptz not null default now(),
  contacted_at    timestamptz,
  note            text,
  outcome         text
);
create index on public.task_followups (assignment_id);

create table public.task_dependencies (
  task_id     bigint references public.tasks(id) on delete cascade,
  depends_on  bigint references public.tasks(id) on delete cascade,
  primary key (task_id, depends_on),
  check (task_id <> depends_on)
);

create table public.task_comments (
  id          bigint generated always as identity primary key,
  task_id     bigint not null references public.tasks(id) on delete cascade,
  author_id   uuid not null references public.employees(id),
  body        text not null,
  created_at  timestamptz not null default now()
);
create index on public.task_comments (task_id, created_at);

create table public.attachments (
  id           bigint generated always as identity primary key,
  owner_table  text not null check (owner_table in ('tasks','discussion_messages','qa_reports','sop_versions','messages')),
  owner_id     bigint not null,
  storage_path text,
  url          text,
  label        text,
  uploaded_by  uuid references public.employees(id),
  created_at   timestamptz not null default now(),
  check (storage_path is not null or url is not null)
);
create index on public.attachments (owner_table, owner_id);

create table public.task_activity (
  id          bigint generated always as identity primary key,
  task_id     bigint not null references public.tasks(id) on delete cascade,
  actor_id    uuid references public.employees(id),
  event       text not null,
  detail      jsonb not null default '{}'::jsonb,
  at          timestamptz not null default now()
);
create index on public.task_activity (task_id, at);

-- ---------- quality control ------------------------------------------
create table public.qa_templates (
  id          bigint generated always as identity primary key,
  name        text not null,
  kind        public.task_kind not null,
  client_id   bigint references public.clients(id),
  checklist   jsonb not null,
  active      boolean not null default true
);
alter table public.tasks add constraint tasks_qa_fk foreign key (qa_template_id) references public.qa_templates(id);

create table public.qa_reports (
  id             bigint generated always as identity primary key,
  task_id        bigint not null references public.tasks(id) on delete cascade,
  round          smallint not null default 1,
  outcome        public.qa_outcome not null,
  checked_items  jsonb not null,
  ai_model       text,
  reviewer_id    uuid references public.employees(id),
  reviewer_note  text,
  created_at     timestamptz not null default now(),
  unique (task_id, round)
);

-- ---------- discussions & issues -------------------------------------
create table public.discussions (
  id          bigint generated always as identity primary key,
  title       text not null,
  task_id     bigint references public.tasks(id),
  client_id   bigint references public.clients(id),
  opened_by   uuid not null references public.employees(id),
  status      text not null default 'open' check (status in ('open','resolved','archived')),
  created_at  timestamptz not null default now()
);

create table public.discussion_participants (
  discussion_id bigint references public.discussions(id) on delete cascade,
  employee_id   uuid references public.employees(id),
  invited_by    uuid references public.employees(id),
  primary key (discussion_id, employee_id)
);

create table public.discussion_messages (
  id            bigint generated always as identity primary key,
  discussion_id bigint not null references public.discussions(id) on delete cascade,
  author_id     uuid not null references public.employees(id),
  asked_to      uuid references public.employees(id),
  reply_to      bigint references public.discussion_messages(id),
  body          text not null,
  created_at    timestamptz not null default now()
);
create index on public.discussion_messages (discussion_id, created_at);

create table public.issue_records (
  id                 bigint generated always as identity primary key,
  discussion_id      bigint unique references public.discussions(id),
  summary            text not null,
  root_cause         public.root_cause not null default 'unknown',
  root_cause_note    text,
  corrective_action  text,
  prevention         text,
  decided_by         uuid references public.employees(id),
  ai_summary         text,
  created_at         timestamptz not null default now()
);

-- ---------- knowledge & the Assistaa Brain ----------------------------
create table public.sop_documents (
  id              bigint generated always as identity primary key,
  title           text not null,
  category        text not null,
  client_id       bigint references public.clients(id),
  current_version int,
  created_at      timestamptz not null default now()
);

create table public.sop_versions (
  id          bigint generated always as identity primary key,
  sop_id      bigint not null references public.sop_documents(id) on delete cascade,
  version     int not null,
  body_md     text not null,
  approved_by uuid references public.employees(id),
  approved_at timestamptz,
  unique (sop_id, version)
);

create table public.knowledge_chunks (
  id           bigint generated always as identity primary key,
  source_table text not null check (source_table in ('sop_versions','decisions','qa_reports','issue_records')),
  source_id    bigint not null,
  heading      text,
  content      text not null,
  client_id    bigint references public.clients(id),
  embedding    extensions.vector(1024),
  created_at   timestamptz not null default now()
);
create index on public.knowledge_chunks using hnsw (embedding extensions.vector_cosine_ops);
create index on public.knowledge_chunks (source_table, source_id);

create table public.decisions (
  id             bigint generated always as identity primary key,
  category       text not null,
  client_id      bigint references public.clients(id),
  case_summary   text not null,
  context        jsonb not null default '{}'::jsonb,
  ai_suggestion  text,
  ai_sources     jsonb,
  state          public.decision_state not null default 'suggested',
  final_answer   text,
  reason         text,
  decided_by     uuid references public.employees(id),
  decided_at     timestamptz,
  created_at     timestamptz not null default now()
);
create index on public.decisions (category, client_id, state);

-- ---------- communication --------------------------------------------
create table public.channels (
  id          bigint generated always as identity primary key,
  name        text,
  kind        text not null check (kind in ('announcement','department','group','direct','task')),
  task_id     bigint references public.tasks(id),
  created_by  uuid references public.employees(id),
  created_at  timestamptz not null default now()
);

create table public.channel_members (
  channel_id   bigint references public.channels(id) on delete cascade,
  employee_id  uuid references public.employees(id),
  last_read_at timestamptz,
  primary key (channel_id, employee_id)
);

create table public.messages (
  id          bigint generated always as identity primary key,
  channel_id  bigint not null references public.channels(id) on delete cascade,
  author_id   uuid not null references public.employees(id),
  body        text not null,
  mentions    uuid[] not null default '{}',
  pinned      boolean not null default false,
  poll        jsonb,
  became_task bigint references public.tasks(id),
  created_at  timestamptz not null default now()
);
create index on public.messages (channel_id, created_at desc);

-- today's app inbox: manager → person messages with a reply
create table public.inbox_messages (
  id           bigint generated always as identity primary key,
  to_id        uuid not null references public.employees(id) on delete cascade,
  from_id      uuid references public.employees(id),
  body         text not null,
  kind         text not null default 'Message',
  seen_at      timestamptz,
  reply        text,
  replied_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index on public.inbox_messages (to_id, created_at desc);

create table public.notifications (
  id           bigint generated always as identity primary key,
  employee_id  uuid not null references public.employees(id) on delete cascade,
  kind         text not null,
  title        text not null,
  body         text,
  link         text,
  read_at      timestamptz,
  pushed_at    timestamptz,
  created_at   timestamptz not null default now()
);
create index on public.notifications (employee_id, created_at desc) where read_at is null;

create table public.push_tokens (
  token        text primary key,
  employee_id  uuid not null references public.employees(id) on delete cascade,
  device       text,
  app_address  text,
  updated_at   timestamptz not null default now()
);
create index on public.push_tokens (employee_id);

-- ---------- attendance, pay rules & HR ---------------------------------
create table public.work_events (                         -- old Activity tab
  id           bigint generated always as identity primary key,
  employee_id  uuid not null references public.employees(id),
  event        text not null check (event in ('start','break_start','break_end','done','request_tickets')),
  amount       int,
  status       text,
  note         text,
  at           timestamptz not null default now()
);
create index on public.work_events (employee_id, at desc);
create index on public.work_events (at desc);

create table public.reports (                             -- old Reports tab
  id           bigint generated always as identity primary key,
  employee_id  uuid not null references public.employees(id),
  kind         text not null,                            -- Start report, End report, Question, Problem, Leave request ...
  body         text not null,
  reply        text,
  replied_by   text,
  status       text not null default 'New',
  created_at   timestamptz not null default now()
);
create index on public.reports (employee_id, created_at desc);
create index on public.reports (created_at desc);

create table public.daily_stats (                         -- one row per person, day and metric
  id           bigint generated always as identity primary key,
  day          date not null,
  employee_id  uuid not null references public.employees(id),
  metric       text not null,                            -- messages_sent, tickets_closed, waiting_20h, first_reply_h, products_listed
  value        numeric not null,
  note         text,
  unique (day, employee_id, metric)
);
create index on public.daily_stats (employee_id, day desc);

create table public.ticket_splits (                       -- old Splits tab (support)
  id          bigint generated always as identity primary key,
  from_date   date not null,
  shares      jsonb not null,                           -- {"Rifat":30,"Rakibuzzaman":25,...}
  set_by      uuid references public.employees(id),
  note        text
);

create table public.tickets_waiting (
  id          bigint generated always as identity primary key,
  ticket_no   text not null,
  employee_id uuid references public.employees(id),
  hours       numeric,
  link        text,
  checked_at  timestamptz not null default now()
);
create index on public.tickets_waiting (employee_id);

create table public.client_messages (                     -- client messages awaiting an answer
  id          bigint generated always as identity primary key,
  sent_at     timestamptz not null,
  sender      text not null,
  channel     text,
  body        text,
  answered    boolean not null default false,
  hours_waiting numeric,
  checked_at  timestamptz not null default now()
);

create table public.fines (
  id           bigint generated always as identity primary key,
  day          date not null,
  employee_id  uuid not null references public.employees(id),
  rule         text not null,
  ref          text,
  amount       numeric not null,
  unit         text not null check (unit in ('tickets','bdt')),
  status       text not null default 'active' check (status in ('active','waived')),
  note         text,
  waived_by    uuid references public.employees(id),
  created_at   timestamptz not null default now()
);
create index on public.fines (employee_id, day desc);

create table public.scores (
  day          date not null,
  employee_id  uuid not null references public.employees(id),
  score        numeric(3,1) not null check (score between 0 and 10),
  parts        jsonb not null default '{}'::jsonb,       -- {"speed":3,"activity":2,...}
  why          text,
  primary key (day, employee_id)
);
create index on public.scores (employee_id, day desc);

create table public.leave_requests (
  id           bigint generated always as identity primary key,
  employee_id  uuid not null references public.employees(id),
  starts_on    date not null,
  ends_on      date not null,
  reason       text,
  state        public.leave_state not null default 'requested',
  decided_by   uuid references public.employees(id),
  decided_at   timestamptz,
  check (ends_on >= starts_on)
);
create index on public.leave_requests (employee_id);

create table public.holidays (
  day   date primary key,
  name  text not null
);

-- ---------- training ---------------------------------------------------
create table public.training_materials (
  id        bigint generated always as identity primary key,
  title     text not null,
  sop_id    bigint references public.sop_documents(id),
  quiz      jsonb
);

create table public.training_records (
  id           bigint generated always as identity primary key,
  material_id  bigint not null references public.training_materials(id),
  employee_id  uuid not null references public.employees(id),
  assigned_at  timestamptz not null default now(),
  completed_at timestamptz,
  score        numeric
);
create index on public.training_records (employee_id);

-- ---------- automation, reports, audit --------------------------------
create table public.automation_rules (
  id          bigint generated always as identity primary key,
  name        text not null,
  trigger     text not null,
  conditions  jsonb not null default '{}'::jsonb,
  actions     jsonb not null,
  active      boolean not null default true,
  created_by  uuid references public.employees(id)
);

create table public.automation_runs (
  id          bigint generated always as identity primary key,
  rule_id     bigint references public.automation_rules(id),
  subject     text,
  result      text,
  at          timestamptz not null default now()
);

create table public.client_reports (
  id          bigint generated always as identity primary key,
  client_id   bigint not null references public.clients(id),
  period      daterange not null,
  body_md     text not null,
  created_at  timestamptz not null default now()
);

create table public.audit_logs (
  id          bigint generated always as identity primary key,
  actor_id    uuid,
  table_name  text not null,
  row_id      text not null,
  action      text not null check (action in ('insert','update','delete')),
  before      jsonb,
  after       jsonb,
  at          timestamptz not null default now()
);
create index on public.audit_logs (table_name, row_id, at desc);

-- ---------- updated_at ----------------------------------------------
create or replace function private.touch() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger employees_touch before update on public.employees for each row execute function private.touch();
create trigger tasks_touch     before update on public.tasks     for each row execute function private.touch();

-- ---------- access helpers (schema private, not exposed as RPC) ------
create or replace function private.me() returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.employees where auth_user_id = (select auth.uid()) and active
$$;

create or replace function private.my_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select role from public.employees where auth_user_id = (select auth.uid()) and active
$$;

create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select role in ('owner','admin') from public.employees where auth_user_id = (select auth.uid()) and active), false)
$$;

create or replace function private.manages(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_admin()
      or exists (select 1 from public.employees e where e.id = target and e.manager_id = private.me())
      or exists (select 1 from public.employees e join public.teams t on t.id = e.team_id
                 where e.id = target and t.lead_id = private.me())
$$;

grant usage on schema private to authenticated;
revoke all on all functions in schema private from public, anon;
grant execute on function private.me(), private.my_role(), private.is_admin(), private.manages(uuid) to authenticated;

-- ---------- Row Level Security --------------------------------------
-- 1) RLS on, and an "owner/admin can do everything" policy, on EVERY public table.
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "admins: all" on public.%I for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()))', t);
  end loop;
end $$;
alter table private.employee_pins enable row level security;   -- no policies: service role only

-- 2) Team members: their own rows (and team leads/managers: their people).
create policy "people: self or managed" on public.employees
  for select to authenticated using (id = (select private.me()) or (select private.manages(id)));
create policy "people: edit own profile" on public.employees
  for update to authenticated using (id = (select private.me())) with check (id = (select private.me()));
-- column guard: members may only change their own profile fields
revoke update on public.employees from authenticated;
grant update (about, skills, photo_path, phone) on public.employees to authenticated;

create policy "teams: read" on public.teams for select to authenticated using (true);
create policy "rules: read own team" on public.rules for select to authenticated
  using (team_id = (select team_id from public.employees where id = (select private.me())));

do $$
declare t text;
begin
  foreach t in array array['work_events','reports','daily_stats','fines','scores','leave_requests','notifications','push_tokens','training_records','tickets_waiting'] loop
    execute format('create policy "own or managed: read" on public.%I for select to authenticated using (employee_id = (select private.me()) or (select private.manages(employee_id)))', t);
  end loop;
  foreach t in array array['work_events','reports','leave_requests','push_tokens'] loop
    execute format('create policy "own: insert" on public.%I for insert to authenticated with check (employee_id = (select private.me()))', t);
  end loop;
end $$;
create policy "own: mark read" on public.notifications for update to authenticated
  using (employee_id = (select private.me())) with check (employee_id = (select private.me()));
create policy "own: remove device" on public.push_tokens for delete to authenticated
  using (employee_id = (select private.me()));

create policy "inbox: mine or managed" on public.inbox_messages for select to authenticated
  using (to_id = (select private.me()) or from_id = (select private.me()) or (select private.manages(to_id)));
create policy "inbox: reply to mine" on public.inbox_messages for update to authenticated
  using (to_id = (select private.me())) with check (to_id = (select private.me()));
revoke update on public.inbox_messages from authenticated;
grant update (seen_at, reply, replied_at) on public.inbox_messages to authenticated;

create policy "tasks: assigned or managed" on public.tasks for select to authenticated using (
  created_by = (select private.me())
  or exists (select 1 from public.task_assignments a
             where a.task_id = tasks.id and a.ended_at is null
               and (a.employee_id = (select private.me()) or (select private.manages(a.employee_id)))));
create policy "assignments: own or managed" on public.task_assignments for select to authenticated
  using (employee_id = (select private.me()) or (select private.manages(employee_id)));
create policy "assignments: ack own" on public.task_assignments for update to authenticated
  using (employee_id = (select private.me())) with check (employee_id = (select private.me()));
revoke update on public.task_assignments from authenticated;
grant update (first_seen_at, first_response_at, ack) on public.task_assignments to authenticated;

create policy "task comments: on visible tasks" on public.task_comments for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id));
create policy "task comments: write on visible tasks" on public.task_comments for insert to authenticated
  with check (author_id = (select private.me()) and exists (select 1 from public.tasks t where t.id = task_id));

-- anonymous visitors get nothing
revoke all on all tables in schema public from anon;
