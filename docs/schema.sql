-- =====================================================================
-- Assistaa OS — PostgreSQL schema for Supabase (Phase 1 draft, v0.1)
-- Not applied anywhere yet. Run in a NEW Supabase project only after review.
-- Conventions: uuid keys for people, bigint identity for high-volume rows,
-- timestamptz everywhere, soft status via enums, RLS on every table.
-- =====================================================================

create extension if not exists pgcrypto;
create extension if not exists vector;      -- Assistaa Brain (semantic search)
create extension if not exists pg_cron;     -- central scheduled checks

-- ---------- enums ----------------------------------------------------
create type app_role       as enum ('owner','admin','manager','team_lead','employee');
create type task_status    as enum ('pending','in_progress','under_review','revision_required','completed','cancelled','on_hold');
create type task_priority  as enum ('urgent','high','medium','low');
create type task_kind      as enum ('product_listing','product_research','customer_support','dispute_paypal','dispute_stripe','dispute_klarna','ad_creative','store_management','other');
create type qa_outcome     as enum ('passed','failed','requires_human_review');
create type ack_state      as enum ('waiting','seen','responded','not_seen','escalated');
create type root_cause     as enum ('unclear_instructions','knowledge_gap','miscommunication','technical_issue','individual_mistake','client_change','unknown');
create type leave_state    as enum ('requested','approved','declined','cancelled');
create type decision_state as enum ('suggested','approved','changed','rejected');

-- ---------- organisation ----------------------------------------------
create table departments (
  id          smallint generated always as identity primary key,
  name        text not null unique,                   -- Support, Listings, Disputes, Creatives
  created_at  timestamptz not null default now()
);

create table teams (
  id            smallint generated always as identity primary key,
  department_id smallint references departments(id),
  name          text not null unique,                 -- e.g. Peptonix Support, Store Management
  lead_id       uuid,                                 -- FK added after employees
  created_at    timestamptz not null default now()
);

create table employees (
  id             uuid primary key references auth.users(id) on delete restrict,
  full_name      text not null,
  display_name   text not null,
  role           app_role not null default 'employee',
  team_id        smallint references teams(id),
  manager_id     uuid references employees(id),
  aliases        jsonb not null default '{}'::jsonb,  -- {"slack":"Mr. Green","commslayer":"Jessica"}
  email          text unique,
  phone          text,
  photo_path     text,                                -- Supabase Storage path
  about          text check (char_length(about) <= 300),
  pay_model      text check (pay_model in ('fixed','per_message','mixed')),
  rate_per_unit  numeric(10,2),
  work_start     time not null default '10:00',
  day_off        smallint check (day_off between 0 and 6),   -- 5 = Friday
  active         boolean not null default true,
  joined_on      date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
alter table teams add constraint teams_lead_fk foreign key (lead_id) references employees(id);
create index on employees (team_id) where active;

create table employee_skills (
  employee_id uuid references employees(id) on delete cascade,
  skill       text not null,
  level       smallint not null check (level between 1 and 5),
  primary key (employee_id, skill)
);

-- PINs never stored in plain text: login uses Supabase Auth; this table only
-- rate-limits PIN attempts per person.
create table login_attempts (
  id          bigint generated always as identity primary key,
  employee_id uuid references employees(id),
  ok          boolean not null,
  at          timestamptz not null default now(),
  ip_hash     text
);
create index on login_attempts (employee_id, at desc);

create table settings (
  key         text primary key,                       -- ack_threshold_minutes, silent_until, ...
  value       jsonb not null,
  updated_by  uuid references employees(id),
  updated_at  timestamptz not null default now()
);

-- ---------- clients & stores -----------------------------------------
create table clients (
  id          bigint generated always as identity primary key,
  name        text not null unique,                   -- Peptonix, New Global Vision, Amariah & Co., Oxybio
  business    text,
  notes       text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table client_contacts (
  id          bigint generated always as identity primary key,
  client_id   bigint not null references clients(id) on delete cascade,
  name        text not null,
  role        text,
  email       text,
  channel     text,                                   -- slack / whatsapp / email
  handle      text
);

create table client_stores (
  id             bigint generated always as identity primary key,
  client_id      bigint not null references clients(id) on delete cascade,
  name           text not null,                        -- Glamstadt, Rose Malibu ...
  platform       text not null check (platform in ('shopify','woocommerce','other')),
  domain         text,
  secret_ref     text,                                 -- Supabase Vault secret id; never the token itself
  read_only      boolean not null default true,
  active         boolean not null default true,
  unique (client_id, name)
);

create table client_assignments (
  client_id   bigint references clients(id) on delete cascade,
  employee_id uuid references employees(id) on delete cascade,
  since       date not null default current_date,
  primary key (client_id, employee_id)
);

create table projects (
  id          bigint generated always as identity primary key,
  client_id   bigint not null references clients(id),
  name        text not null,
  status      text not null default 'active',
  starts_on   date,
  ends_on     date
);

-- ---------- tasks -----------------------------------------------------
create sequence task_code_seq;
create table tasks (
  id                    bigint generated always as identity primary key,
  code                  text not null unique default ('T-' || nextval('task_code_seq')),
  title                 text not null check (char_length(title) <= 300),
  instructions          text,
  kind                  task_kind not null default 'other',
  status                task_status not null default 'pending',
  priority              task_priority not null default 'medium',
  client_id             bigint references clients(id),
  store_id              bigint references client_stores(id),
  project_id            bigint references projects(id),
  qa_template_id        bigint,                       -- FK added after qa_templates
  due_at                timestamptz,
  estimate_minutes      int check (estimate_minutes > 0),
  ack_threshold_minutes int not null default 60,      -- configurable per task
  recurrence            text,                         -- RFC 5545 RRULE, e.g. FREQ=DAILY
  parent_recurring_id   bigint references tasks(id),
  created_by            uuid not null references employees(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  completed_at          timestamptz
);
create index on tasks (status, due_at);
create index on tasks (client_id, status);

create table task_assignments (
  id                 bigint generated always as identity primary key,
  task_id            bigint not null references tasks(id) on delete cascade,
  employee_id        uuid not null references employees(id),
  is_primary         boolean not null default true,
  assigned_by        uuid not null references employees(id),
  assigned_at        timestamptz not null default now(),
  first_seen_at      timestamptz,
  first_response_at  timestamptz,
  ack                ack_state not null default 'waiting',
  ended_at           timestamptz,                     -- set on reassignment
  unique (task_id, employee_id, assigned_at)
);
create index on task_assignments (employee_id) where ended_at is null;
create index on task_assignments (ack, assigned_at) where ack in ('waiting','not_seen');

create table task_followups (
  id              bigint generated always as identity primary key,
  assignment_id   bigint not null references task_assignments(id) on delete cascade,
  follower_id     uuid not null references employees(id),
  requested_by    uuid not null references employees(id),
  requested_at    timestamptz not null default now(),
  contacted_at    timestamptz,
  note            text,
  outcome         text
);

create table task_dependencies (
  task_id     bigint references tasks(id) on delete cascade,
  depends_on  bigint references tasks(id) on delete cascade,
  primary key (task_id, depends_on),
  check (task_id <> depends_on)
);

create table task_comments (
  id          bigint generated always as identity primary key,
  task_id     bigint not null references tasks(id) on delete cascade,
  author_id   uuid not null references employees(id),
  body        text not null,
  created_at  timestamptz not null default now()
);
create index on task_comments (task_id, created_at);

create table attachments (                            -- shared by tasks, discussions, QA, SOPs
  id           bigint generated always as identity primary key,
  owner_table  text not null check (owner_table in ('tasks','discussion_messages','qa_reports','sop_versions','messages')),
  owner_id     bigint not null,
  storage_path text,
  url          text,                                  -- reference links
  label        text,
  uploaded_by  uuid references employees(id),
  created_at   timestamptz not null default now(),
  check (storage_path is not null or url is not null)
);
create index on attachments (owner_table, owner_id);

create table task_activity (                          -- complete history, written by triggers
  id          bigint generated always as identity primary key,
  task_id     bigint not null references tasks(id) on delete cascade,
  actor_id    uuid references employees(id),
  event       text not null,                          -- created, status_changed, reassigned, seen, ...
  detail      jsonb not null default '{}'::jsonb,
  at          timestamptz not null default now()
);
create index on task_activity (task_id, at);

-- ---------- quality control ------------------------------------------
create table qa_templates (
  id          bigint generated always as identity primary key,
  name        text not null,
  kind        task_kind not null,
  client_id   bigint references clients(id),           -- null = company default
  checklist   jsonb not null,                          -- [{"id":"title","rule":"≤ 70 chars, brand first"}]
  active      boolean not null default true
);
alter table tasks add constraint tasks_qa_fk foreign key (qa_template_id) references qa_templates(id);

create table qa_reports (
  id             bigint generated always as identity primary key,
  task_id        bigint not null references tasks(id) on delete cascade,
  round          smallint not null default 1,
  outcome        qa_outcome not null,
  checked_items  jsonb not null,    -- [{"item":"title","verified":true,"source":"shopify api","ok":false,"note":"…"}]
  ai_model       text,
  reviewer_id    uuid references employees(id),
  reviewer_note  text,
  created_at     timestamptz not null default now(),
  unique (task_id, round)
);

-- ---------- discussions & issues -------------------------------------
create table discussions (
  id          bigint generated always as identity primary key,
  title       text not null,
  task_id     bigint references tasks(id),
  client_id   bigint references clients(id),
  opened_by   uuid not null references employees(id),
  status      text not null default 'open' check (status in ('open','resolved','archived')),
  created_at  timestamptz not null default now()
);

create table discussion_participants (
  discussion_id bigint references discussions(id) on delete cascade,
  employee_id   uuid references employees(id),
  invited_by    uuid references employees(id),
  primary key (discussion_id, employee_id)
);

create table discussion_messages (
  id            bigint generated always as identity primary key,
  discussion_id bigint not null references discussions(id) on delete cascade,
  author_id     uuid not null references employees(id),
  asked_to      uuid references employees(id),        -- "who asked whom"
  reply_to      bigint references discussion_messages(id),
  body          text not null,
  created_at    timestamptz not null default now()
);
create index on discussion_messages (discussion_id, created_at);

create table issue_records (                           -- outcome of an investigation
  id                 bigint generated always as identity primary key,
  discussion_id      bigint unique references discussions(id),
  summary            text not null,
  root_cause         root_cause not null default 'unknown',
  root_cause_note    text,
  corrective_action  text,
  prevention         text,
  decided_by         uuid references employees(id),  -- a person, never the AI
  ai_summary         text,                           -- labelled as AI-written
  created_at         timestamptz not null default now()
);

-- ---------- knowledge & the Assistaa Brain ----------------------------
create table sop_documents (
  id          bigint generated always as identity primary key,
  title       text not null,
  category    text not null,                         -- Product Listing, PayPal Disputes, ...
  client_id   bigint references clients(id),
  current_version int,
  created_at  timestamptz not null default now()
);

create table sop_versions (
  id          bigint generated always as identity primary key,
  sop_id      bigint not null references sop_documents(id) on delete cascade,
  version     int not null,
  body_md     text not null,
  approved_by uuid references employees(id),
  approved_at timestamptz,
  unique (sop_id, version)
);

create table knowledge_chunks (                       -- searchable pieces of SOPs and decisions
  id           bigint generated always as identity primary key,
  source_table text not null check (source_table in ('sop_versions','decisions','qa_reports','issue_records')),
  source_id    bigint not null,
  heading      text,
  content      text not null,
  client_id    bigint references clients(id),
  embedding    vector(1024),
  created_at   timestamptz not null default now()
);
create index on knowledge_chunks using hnsw (embedding vector_cosine_ops);
create index on knowledge_chunks (source_table, source_id);

create table decisions (                              -- "what would Atiq do" — the core of the Brain
  id             bigint generated always as identity primary key,
  category       text not null,                       -- refund, reship, listing_format, dispute_evidence ...
  client_id      bigint references clients(id),
  case_summary   text not null,
  context        jsonb not null default '{}'::jsonb,  -- order value, history, links (no card or ID numbers)
  ai_suggestion  text,
  ai_sources     jsonb,                               -- chunks it relied on
  state          decision_state not null default 'suggested',
  final_answer   text,
  reason         text,                                -- Atiq's why, the most valuable field
  decided_by     uuid references employees(id),
  decided_at     timestamptz,
  created_at     timestamptz not null default now()
);
create index on decisions (category, client_id, state);

-- ---------- communication --------------------------------------------
create table channels (
  id          bigint generated always as identity primary key,
  name        text,
  kind        text not null check (kind in ('announcement','department','group','direct','task')),
  task_id     bigint references tasks(id),
  created_by  uuid references employees(id),
  created_at  timestamptz not null default now()
);

create table channel_members (
  channel_id  bigint references channels(id) on delete cascade,
  employee_id uuid references employees(id),
  last_read_at timestamptz,
  primary key (channel_id, employee_id)
);

create table messages (
  id          bigint generated always as identity primary key,
  channel_id  bigint not null references channels(id) on delete cascade,
  author_id   uuid not null references employees(id),
  body        text not null,
  mentions    uuid[] not null default '{}',
  pinned      boolean not null default false,
  poll        jsonb,
  became_task bigint references tasks(id),          -- "convert message into task"
  created_at  timestamptz not null default now()
);
create index on messages (channel_id, created_at desc);

create table notifications (
  id           bigint generated always as identity primary key,
  employee_id  uuid not null references employees(id) on delete cascade,
  kind         text not null,
  title        text not null,
  body         text,
  link         text,
  read_at      timestamptz,
  pushed_at    timestamptz,
  created_at   timestamptz not null default now()
);
create index on notifications (employee_id, created_at desc) where read_at is null;

create table push_tokens (
  token        text primary key,
  employee_id  uuid not null references employees(id) on delete cascade,
  device       text,
  updated_at   timestamptz not null default now()
);

-- ---------- attendance, pay rules & HR ---------------------------------
create table work_events (                            -- start, break_start, break_end, done
  id           bigint generated always as identity primary key,
  employee_id  uuid not null references employees(id),
  event        text not null check (event in ('start','break_start','break_end','done','request_tickets')),
  note         text,
  amount       int,
  at           timestamptz not null default now()
);
create index on work_events (employee_id, at desc);

create table reports (                                -- start/end reports and messages (old Reports tab)
  id           bigint generated always as identity primary key,
  employee_id  uuid not null references employees(id),
  kind         text not null,                         -- Start report, End report, Question, Leave request ...
  body         text not null,
  reply        text,
  replied_by   text,                                  -- 'Claude' or a person
  created_at   timestamptz not null default now()
);

create table daily_stats (                            -- messages, closed tickets, products per day
  day          date not null,
  employee_id  uuid not null references employees(id),
  client_id    bigint references clients(id),
  metric       text not null,
  value        numeric not null,
  primary key (day, employee_id, metric, client_id)
);

create table fines (
  id           bigint generated always as identity primary key,
  day          date not null,
  employee_id  uuid not null references employees(id),
  rule         text not null,
  ref          text,
  amount       numeric not null,
  unit         text not null check (unit in ('tickets','bdt')),
  status       text not null default 'active' check (status in ('active','waived')),
  waived_by    uuid references employees(id),
  created_at   timestamptz not null default now()
);

create table scores (
  day          date not null,
  employee_id  uuid not null references employees(id),
  score        numeric(3,1) not null check (score between 0 and 10),
  why          text,
  primary key (day, employee_id)
);

create table leave_requests (
  id           bigint generated always as identity primary key,
  employee_id  uuid not null references employees(id),
  starts_on    date not null,
  ends_on      date not null,
  reason       text,
  state        leave_state not null default 'requested',
  decided_by   uuid references employees(id),
  decided_at   timestamptz,
  check (ends_on >= starts_on)
);

create table holidays (
  day   date primary key,
  name  text not null
);

-- ---------- training ---------------------------------------------------
create table training_materials (
  id        bigint generated always as identity primary key,
  title     text not null,
  sop_id    bigint references sop_documents(id),
  quiz      jsonb                                      -- [{"q":…,"options":[…],"answer":1}]
);

create table training_records (
  id           bigint generated always as identity primary key,
  material_id  bigint not null references training_materials(id),
  employee_id  uuid not null references employees(id),
  assigned_at  timestamptz not null default now(),
  completed_at timestamptz,
  score        numeric
);

-- ---------- automation, reports, audit --------------------------------
create table automation_rules (
  id          bigint generated always as identity primary key,
  name        text not null,
  trigger     text not null,                           -- task_assigned, task_unseen, deadline_near ...
  conditions  jsonb not null default '{}'::jsonb,
  actions     jsonb not null,                          -- [{"notify":"manager"}]
  active      boolean not null default true,
  created_by  uuid references employees(id)
);

create table automation_runs (
  id          bigint generated always as identity primary key,
  rule_id     bigint references automation_rules(id),
  subject     text,
  result      text,
  at          timestamptz not null default now()
);

create table client_reports (
  id          bigint generated always as identity primary key,
  client_id   bigint not null references clients(id),
  period      daterange not null,
  body_md     text not null,
  created_at  timestamptz not null default now()
);

create table audit_logs (                              -- written by triggers on sensitive tables
  id          bigint generated always as identity primary key,
  actor_id    uuid,
  table_name  text not null,
  row_id      text not null,
  action      text not null check (action in ('insert','update','delete')),
  before      jsonb,
  after       jsonb,
  at          timestamptz not null default now()
);
create index on audit_logs (table_name, row_id, at desc);

-- ---------- access helpers & Row Level Security (pattern) -------------
create or replace function me() returns uuid language sql stable as $$ select auth.uid() $$;

create or replace function my_role() returns app_role language sql stable security definer set search_path = public as $$
  select role from employees where id = auth.uid()
$$;

create or replace function manages(target uuid) returns boolean language sql stable security definer set search_path = public as $$
  select my_role() in ('owner','admin')
      or exists (select 1 from employees e where e.id = target and e.manager_id = auth.uid())
      or exists (select 1 from employees e join teams t on t.id = e.team_id where e.id = target and t.lead_id = auth.uid())
$$;

alter table employees        enable row level security;
alter table tasks            enable row level security;
alter table task_assignments enable row level security;
alter table fines            enable row level security;
alter table decisions        enable row level security;
-- (every other table: enable RLS the same way; policies per module in Phase 1)

create policy "see self, team leads see their people" on employees
  for select using (id = me() or manages(id));

create policy "own fines; managers see their people" on fines
  for select using (employee_id = me() or manages(employee_id));

create policy "assigned or managed tasks" on tasks
  for select using (
    my_role() in ('owner','admin')
    or created_by = me()
    or exists (select 1 from task_assignments a where a.task_id = tasks.id and (a.employee_id = me() or manages(a.employee_id)))
  );

create policy "own assignments" on task_assignments
  for select using (employee_id = me() or manages(employee_id));

create policy "owner only" on decisions
  for all using (my_role() in ('owner','admin')) with check (my_role() in ('owner','admin'));

-- ---------- central scheduled checks (one job, not one per task) -------
-- every 5 minutes: mark unseen assignments past their threshold and queue notifications
-- select cron.schedule('ack-check', '*/5 * * * *', $$ select run_ack_checks() $$);
