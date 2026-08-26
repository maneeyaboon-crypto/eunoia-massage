-- ============================================================================
-- EUNOIA Massage — Management System
-- Migration 001: Schema, RLS, triggers
-- Timezone convention: all timestamps stored as timestamptz (UTC).
--   Business "work_date" is the Asia/Bangkok calendar date.
-- ============================================================================

create extension if not exists "pgcrypto";

-- Helper: Bangkok "today"
create or replace function app_today()
returns date
language sql
stable
as $$
  select (now() at time zone 'Asia/Bangkok')::date;
$$;

-- ============================================================================
-- 1. USERS / PROFILES
-- ============================================================================

create table if not exists profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text,
  role        text not null default 'admin' check (role in ('owner', 'admin')),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

comment on table profiles is 'Application users. role=owner sees finance/settings/audit; role=admin is reception.';

create or replace function is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'owner' and is_active
  );
$$;

create or replace function is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and is_active
  );
$$;

-- First user to sign up becomes Owner, everyone after is Admin/Reception.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  select count(*) into v_count from profiles;
  insert into profiles (id, email, full_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1)),
    case when v_count = 0 then 'owner' else 'admin' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============================================================================
-- 2. THERAPISTS
-- ============================================================================

create table if not exists therapists (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  nickname        text,
  phone           text,
  is_active       boolean not null default true,
  -- Per-therapist commission overrides (null => fall back to service default)
  pay_override_30 numeric(10, 2),
  pay_override_60 numeric(10, 2),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table therapists is 'Never hard-delete: set is_active = false instead (transaction history references them).';

-- ============================================================================
-- 3. SERVICES (Service Master — editable from Settings, no code change needed)
-- ============================================================================

create table if not exists services (
  id                   uuid primary key default gen_random_uuid(),
  name_en              text not null,
  name_th              text,
  price                numeric(10, 2) not null check (price >= 0),
  duration_min         integer not null check (duration_min > 0),
  default_therapist_pay numeric(10, 2) not null default 0 check (default_therapist_pay >= 0),
  is_active            boolean not null default true,
  sort_order           integer not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on column services.price is 'Current list price. Historic sessions snapshot their own price — changing this never alters past transactions.';

-- ============================================================================
-- 4. DAILY QUEUE
-- ============================================================================

do $$ begin
  create type therapist_manual_status as enum ('available', 'break', 'outside_job', 'off_duty');
exception when duplicate_object then null; end $$;

create table if not exists daily_queue (
  id             uuid primary key default gen_random_uuid(),
  work_date      date not null default app_today(),
  therapist_id   uuid not null references therapists (id),
  position       integer not null,
  status         therapist_manual_status not null default 'available',
  checked_in_at  timestamptz not null default now(),
  checked_in_by  uuid references profiles (id),
  note           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (work_date, therapist_id)
);

comment on table daily_queue is
  'Who checked in today and in what order. Order = check-in order, adjustable by Admin. '
  'status only holds MANUAL states; busy / finishing_soon / expected_finished are DERIVED from the active session.';

create index if not exists daily_queue_date_pos_idx on daily_queue (work_date, position);

-- Queue pointer: remembers who received the last customer, so rotation
-- resumes after them instead of restarting at position 1.
create table if not exists queue_state (
  work_date                  date primary key default app_today(),
  last_assigned_therapist_id uuid references therapists (id),
  updated_at                 timestamptz not null default now()
);

comment on table queue_state is 'Current Queue Position pointer for round-robin rotation.';

-- Outside job history (left at / returned at)
create table if not exists outside_job_logs (
  id           uuid primary key default gen_random_uuid(),
  work_date    date not null default app_today(),
  therapist_id uuid not null references therapists (id),
  left_at      timestamptz not null default now(),
  returned_at  timestamptz,
  return_mode  text check (return_mode in ('same_position', 'end_of_queue')),
  note         text,
  created_by   uuid references profiles (id)
);

create index if not exists outside_job_logs_date_idx on outside_job_logs (work_date, therapist_id);

-- ============================================================================
-- 5. MASSAGE SESSIONS (operational + financial source of truth)
-- ============================================================================

create sequence if not exists session_code_seq;

create table if not exists massage_sessions (
  id                 uuid primary key default gen_random_uuid(),
  code               text unique not null,
  work_date          date not null default app_today(),

  therapist_id       uuid not null references therapists (id),
  -- Snapshots so future price/name edits never change old records:
  service_id         uuid references services (id),
  service_name_en    text not null,
  service_name_th    text,
  base_duration_min  integer not null,
  duration_min       integer not null,           -- base + all extensions

  customer_name      text,
  customer_count     integer not null default 1 check (customer_count > 0),
  note               text,

  start_at           timestamptz not null,
  expected_finish_at timestamptz not null,
  finished_at        timestamptz,

  status             text not null default 'active'
                       check (status in ('active', 'finished', 'voided')),

  -- Money. original_price is NEVER overwritten.
  original_price       numeric(10, 2) not null check (original_price >= 0),
  final_price          numeric(10, 2) not null check (final_price >= 0),
  discount             numeric(10, 2) generated always as (original_price - final_price) stored,
  default_therapist_pay numeric(10, 2) not null default 0 check (default_therapist_pay >= 0),
  actual_therapist_pay  numeric(10, 2) not null default 0 check (actual_therapist_pay >= 0),
  shop_revenue          numeric(10, 2) generated always as (final_price - actual_therapist_pay) stored,

  payment_method     text check (payment_method in ('cash', 'qr', 'card', 'other')),

  -- Assignment provenance
  assignment_type    text not null default 'queue'
                       check (assignment_type in ('queue', 'manual', 'customer_request')),
  assignment_reason  text,
  is_customer_request boolean not null default false,
  post_job_queue_action text not null default 'rotation'
                       check (post_job_queue_action in ('rotation', 'end_of_queue')),

  created_by         uuid references profiles (id),
  finished_by        uuid references profiles (id),

  voided_at          timestamptz,
  voided_by          uuid references profiles (id),
  void_reason        text,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table massage_sessions is
  'One row per massage job. Financial records are never hard-deleted — use status = voided.';

create index if not exists sessions_date_idx     on massage_sessions (work_date);
create index if not exists sessions_status_idx   on massage_sessions (status);
create index if not exists sessions_therapist_idx on massage_sessions (therapist_id, work_date);

-- Only one active session per therapist (Business rule #3)
create unique index if not exists sessions_one_active_per_therapist
  on massage_sessions (therapist_id)
  where status = 'active';

-- Human readable code: EU-YYYYMMDD-NNN
create or replace function set_session_code()
returns trigger
language plpgsql
as $$
begin
  if new.code is null or new.code = '' then
    new.code := 'EU-' || to_char(new.work_date, 'YYYYMMDD') || '-' ||
                lpad(nextval('session_code_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_session_code on massage_sessions;
create trigger trg_session_code
  before insert on massage_sessions
  for each row execute function set_session_code();

-- ============================================================================
-- 6. EXTENSIONS (ต่อเวลานวด)
-- ============================================================================

create table if not exists session_extensions (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid not null references massage_sessions (id) on delete cascade,
  added_minutes    integer not null check (added_minutes > 0),
  added_price      numeric(10, 2) not null default 0 check (added_price >= 0),
  added_therapist_pay numeric(10, 2) not null default 0 check (added_therapist_pay >= 0),
  extra_service_id uuid references services (id),
  extra_service_name text,
  note             text,
  created_by       uuid references profiles (id),
  created_at       timestamptz not null default now()
);

create index if not exists session_extensions_session_idx on session_extensions (session_id);

-- ============================================================================
-- 7. PAYMENTS
-- ============================================================================

create table if not exists payments (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references massage_sessions (id),
  work_date      date not null default app_today(),
  method         text not null check (method in ('cash', 'qr', 'card', 'other')),
  amount         numeric(10, 2) not null check (amount >= 0),
  received_by    uuid references profiles (id),
  created_at     timestamptz not null default now()
);

create index if not exists payments_date_idx on payments (work_date);

-- ============================================================================
-- 8. WAITING LIST
-- ============================================================================

create table if not exists waiting_customers (
  id                    uuid primary key default gen_random_uuid(),
  work_date             date not null default app_today(),
  customer_name          text,
  customer_count         integer not null default 1,
  requested_service_id   uuid references services (id),
  requested_therapist_id uuid references therapists (id),
  arrival_at             timestamptz not null default now(),
  note                   text,
  status                 text not null default 'waiting'
                           check (status in ('waiting', 'seated', 'cancelled')),
  seated_session_id      uuid references massage_sessions (id),
  created_by             uuid references profiles (id),
  created_at             timestamptz not null default now()
);

create index if not exists waiting_date_idx on waiting_customers (work_date, status);

-- ============================================================================
-- 9. QUEUE EVENTS (Activity log / timeline)
-- ============================================================================

create table if not exists queue_events (
  id           uuid primary key default gen_random_uuid(),
  work_date    date not null default app_today(),
  at           timestamptz not null default now(),
  event_type   text not null check (event_type in (
                 'check_in', 'received_customer', 'skipped_busy', 'skipped_break',
                 'skipped_outside', 'skipped_off_duty', 'finished_massage',
                 'outside_job_start', 'outside_job_return', 'status_change',
                 'manual_override', 'extended', 'reordered', 'voided', 'day_closed'
               )),
  therapist_id uuid references therapists (id),
  session_id   uuid references massage_sessions (id) on delete set null,
  detail       text,
  meta         jsonb,
  actor_id     uuid references profiles (id)
);

create index if not exists queue_events_date_idx on queue_events (work_date, at desc);

-- ============================================================================
-- 10. DAILY CLOSINGS
-- ============================================================================

create table if not exists daily_closings (
  id                 uuid primary key default gen_random_uuid(),
  work_date          date not null unique,
  closed_at          timestamptz not null default now(),
  closed_by          uuid references profiles (id),
  total_customers    integer not null default 0,
  total_jobs         integer not null default 0,
  gross_sales        numeric(12, 2) not null default 0,
  original_value     numeric(12, 2) not null default 0,
  total_discount     numeric(12, 2) not null default 0,
  therapist_wages    numeric(12, 2) not null default 0,
  net_shop_revenue   numeric(12, 2) not null default 0,
  cash_total         numeric(12, 2) not null default 0,
  qr_total           numeric(12, 2) not null default 0,
  card_total         numeric(12, 2) not null default 0,
  other_total        numeric(12, 2) not null default 0,
  snapshot           jsonb not null default '{}'::jsonb,
  note               text
);

comment on column daily_closings.snapshot is 'Frozen copy of the day: per-therapist breakdown + every transaction as it stood at closing.';

-- ============================================================================
-- 11. AUDIT LOG
-- ============================================================================

create table if not exists audit_logs (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  actor_id    uuid references profiles (id),
  actor_email text,
  table_name  text not null,
  record_id   text,
  action      text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  field_name  text,
  old_value   text,
  new_value   text,
  context     text
);

create index if not exists audit_logs_at_idx     on audit_logs (at desc);
create index if not exists audit_logs_record_idx  on audit_logs (table_name, record_id);

-- Generic field-level audit trigger. Records one row per changed field.
create or replace function audit_row_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor  uuid := auth.uid();
  v_email  text;
  v_fields text[] := coalesce(TG_ARGV, array[]::text[]);
  v_field  text;
  v_old    text;
  v_new    text;
  v_rec_id text;
begin
  select email into v_email from profiles where id = v_actor;

  if TG_OP = 'INSERT' then
    v_rec_id := (to_jsonb(new) ->> 'id');
    insert into audit_logs (actor_id, actor_email, table_name, record_id, action, new_value)
    values (v_actor, v_email, TG_TABLE_NAME, v_rec_id, 'INSERT', to_jsonb(new)::text);
    return new;
  end if;

  if TG_OP = 'DELETE' then
    v_rec_id := (to_jsonb(old) ->> 'id');
    insert into audit_logs (actor_id, actor_email, table_name, record_id, action, old_value)
    values (v_actor, v_email, TG_TABLE_NAME, v_rec_id, 'DELETE', to_jsonb(old)::text);
    return old;
  end if;

  -- UPDATE: log only the watched fields that actually changed
  v_rec_id := (to_jsonb(new) ->> 'id');
  foreach v_field in array v_fields loop
    v_old := to_jsonb(old) ->> v_field;
    v_new := to_jsonb(new) ->> v_field;
    if coalesce(v_old, '~null~') <> coalesce(v_new, '~null~') then
      insert into audit_logs (actor_id, actor_email, table_name, record_id, action,
                              field_name, old_value, new_value)
      values (v_actor, v_email, TG_TABLE_NAME, v_rec_id, 'UPDATE', v_field, v_old, v_new);
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_audit_sessions_ins on massage_sessions;
create trigger trg_audit_sessions_ins
  after insert on massage_sessions
  for each row execute function audit_row_changes();

drop trigger if exists trg_audit_sessions_upd on massage_sessions;
create trigger trg_audit_sessions_upd
  after update on massage_sessions
  for each row execute function audit_row_changes(
    'final_price', 'original_price', 'actual_therapist_pay', 'default_therapist_pay',
    'service_id', 'service_name_en', 'therapist_id', 'start_at', 'expected_finish_at',
    'finished_at', 'duration_min', 'status', 'payment_method', 'void_reason',
    'customer_name', 'note'
  );

drop trigger if exists trg_audit_services_upd on services;
create trigger trg_audit_services_upd
  after update on services
  for each row execute function audit_row_changes(
    'name_en', 'name_th', 'price', 'duration_min', 'default_therapist_pay', 'is_active'
  );

drop trigger if exists trg_audit_services_ins on services;
create trigger trg_audit_services_ins
  after insert on services
  for each row execute function audit_row_changes();

drop trigger if exists trg_audit_therapists_upd on therapists;
create trigger trg_audit_therapists_upd
  after update on therapists
  for each row execute function audit_row_changes(
    'name', 'nickname', 'phone', 'is_active', 'pay_override_30', 'pay_override_60', 'notes'
  );

drop trigger if exists trg_audit_extensions_ins on session_extensions;
create trigger trg_audit_extensions_ins
  after insert on session_extensions
  for each row execute function audit_row_changes();

-- Block hard deletes on financial records
create or replace function block_financial_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Financial records cannot be deleted. Use Void Transaction instead.';
end;
$$;

drop trigger if exists trg_no_delete_sessions on massage_sessions;
create trigger trg_no_delete_sessions
  before delete on massage_sessions
  for each row execute function block_financial_delete();

drop trigger if exists trg_no_delete_payments on payments;
create trigger trg_no_delete_payments
  before delete on payments
  for each row execute function block_financial_delete();

-- updated_at maintenance
create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end; $$;

do $$
declare t text;
begin
  foreach t in array array['therapists', 'services', 'daily_queue', 'massage_sessions'] loop
    execute format('drop trigger if exists trg_touch_%1$s on %1$s', t);
    execute format(
      'create trigger trg_touch_%1$s before update on %1$s for each row execute function touch_updated_at()', t);
  end loop;
end $$;

-- ============================================================================
-- 12. VIEWS
-- ============================================================================

-- Transactions view — what the History page reads.
create or replace view v_transactions as
select
  s.id,
  s.code                as transaction_id,
  s.work_date,
  s.start_at,
  coalesce(s.finished_at, s.expected_finish_at) as finish_at,
  s.status,
  t.id                  as therapist_id,
  t.name                as therapist_name,
  t.nickname            as therapist_nickname,
  s.service_name_en,
  s.service_name_th,
  s.duration_min,
  s.customer_name,
  s.customer_count,
  s.original_price,
  s.final_price,
  s.discount,
  s.default_therapist_pay,
  s.actual_therapist_pay,
  s.shop_revenue,
  s.payment_method,
  s.assignment_type,
  s.is_customer_request,
  s.note,
  s.void_reason,
  s.voided_at,
  cb.email              as created_by_email,
  cb.full_name          as created_by_name,
  fb.email              as finished_by_email,
  s.created_at
from massage_sessions s
join therapists t on t.id = s.therapist_id
left join profiles cb on cb.id = s.created_by
left join profiles fb on fb.id = s.finished_by;

-- Per-therapist daily performance & fairness stats
create or replace view v_therapist_daily_stats as
with jobs as (
  select
    s.work_date,
    s.therapist_id,
    count(*)                                          as jobs,
    sum(s.duration_min)                               as minutes_worked,
    sum(s.final_price)                                as sales_generated,
    sum(s.original_price)                             as original_value,
    sum(s.discount)                                   as discount_given,
    sum(s.actual_therapist_pay)                       as therapist_pay,
    sum(s.shop_revenue)                               as shop_revenue,
    count(*) filter (where s.is_customer_request)     as customer_requests,
    count(*) filter (where s.assignment_type = 'manual') as manual_assignments
  from massage_sessions s
  where s.status <> 'voided'
  group by 1, 2
),
skips as (
  select work_date, therapist_id, count(*) as busy_skips
  from queue_events
  where event_type in ('skipped_busy', 'skipped_break', 'skipped_outside', 'skipped_off_duty')
  group by 1, 2
),
outside as (
  select work_date, therapist_id, count(*) as outside_job_count
  from outside_job_logs
  group by 1, 2
)
select
  coalesce(j.work_date, sk.work_date, o.work_date)       as work_date,
  coalesce(j.therapist_id, sk.therapist_id, o.therapist_id) as therapist_id,
  coalesce(j.jobs, 0)              as jobs,
  coalesce(j.minutes_worked, 0)    as minutes_worked,
  coalesce(j.sales_generated, 0)   as sales_generated,
  coalesce(j.original_value, 0)    as original_value,
  coalesce(j.discount_given, 0)    as discount_given,
  coalesce(j.therapist_pay, 0)     as therapist_pay,
  coalesce(j.shop_revenue, 0)      as shop_revenue,
  coalesce(j.customer_requests, 0) as customer_requests,
  coalesce(j.manual_assignments, 0) as manual_assignments,
  coalesce(sk.busy_skips, 0)       as busy_skips,
  coalesce(o.outside_job_count, 0) as outside_job_count
from jobs j
full outer join skips sk on sk.work_date = j.work_date and sk.therapist_id = j.therapist_id
full outer join outside o on o.work_date = coalesce(j.work_date, sk.work_date)
                         and o.therapist_id = coalesce(j.therapist_id, sk.therapist_id);

-- Daily financial rollup
create or replace view v_daily_financials as
select
  s.work_date,
  count(*)                       as total_jobs,
  sum(s.customer_count)          as total_customers,
  sum(s.original_price)          as original_value,
  sum(s.final_price)             as gross_sales,
  sum(s.discount)                as total_discount,
  sum(s.actual_therapist_pay)    as therapist_wages,
  sum(s.shop_revenue)            as net_shop_revenue,
  sum(case when s.payment_method = 'cash'  then s.final_price else 0 end) as cash_total,
  sum(case when s.payment_method = 'qr'    then s.final_price else 0 end) as qr_total,
  sum(case when s.payment_method = 'card'  then s.final_price else 0 end) as card_total,
  sum(case when s.payment_method = 'other' then s.final_price else 0 end) as other_total,
  sum(case when s.payment_method is null    then s.final_price else 0 end) as unpaid_total
from massage_sessions s
where s.status = 'finished'
group by s.work_date;

-- ============================================================================
-- 13. RPC: assign a therapist + open a session atomically
-- ============================================================================

create or replace function start_session(
  p_therapist_id        uuid,
  p_service_id          uuid,
  p_start_at            timestamptz,
  p_duration_min        integer,
  p_original_price      numeric,
  p_final_price         numeric,
  p_default_pay         numeric,
  p_actual_pay          numeric,
  p_customer_name       text default null,
  p_customer_count      integer default 1,
  p_note               text default null,
  p_assignment_type     text default 'queue',
  p_assignment_reason   text default null,
  p_is_customer_request boolean default false,
  p_post_job_action     text default 'rotation',
  p_skipped             jsonb default '[]'::jsonb
)
returns massage_sessions
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_date    date := (p_start_at at time zone 'Asia/Bangkok')::date;
  v_svc     services;
  v_session massage_sessions;
  v_skip    jsonb;
begin
  if not is_staff() then
    raise exception 'Not authorised';
  end if;

  -- therapist must be checked in today
  if not exists (select 1 from daily_queue where work_date = v_date and therapist_id = p_therapist_id) then
    raise exception 'Therapist is not checked in for %', v_date;
  end if;

  select * into v_svc from services where id = p_service_id;

  insert into massage_sessions (
    work_date, therapist_id, service_id, service_name_en, service_name_th,
    base_duration_min, duration_min, customer_name, customer_count, note,
    start_at, expected_finish_at, original_price, final_price,
    default_therapist_pay, actual_therapist_pay,
    assignment_type, assignment_reason, is_customer_request, post_job_queue_action,
    created_by
  ) values (
    v_date, p_therapist_id, p_service_id,
    coalesce(v_svc.name_en, 'Custom'), v_svc.name_th,
    p_duration_min, p_duration_min, p_customer_name, coalesce(p_customer_count, 1), p_note,
    p_start_at, p_start_at + (p_duration_min || ' minutes')::interval,
    p_original_price, p_final_price, p_default_pay, p_actual_pay,
    p_assignment_type, p_assignment_reason, p_is_customer_request,
    coalesce(p_post_job_action, 'rotation'), auth.uid()
  )
  returning * into v_session;

  -- move the rotation pointer
  insert into queue_state (work_date, last_assigned_therapist_id, updated_at)
  values (v_date, p_therapist_id, now())
  on conflict (work_date) do update
    set last_assigned_therapist_id = excluded.last_assigned_therapist_id,
        updated_at = now();

  -- log the skips that happened while scanning the rotation
  for v_skip in select * from jsonb_array_elements(coalesce(p_skipped, '[]'::jsonb)) loop
    insert into queue_events (work_date, event_type, therapist_id, detail, actor_id)
    values (
      v_date,
      case v_skip ->> 'reason'
        when 'break'       then 'skipped_break'
        when 'outside_job' then 'skipped_outside'
        when 'off_duty'    then 'skipped_off_duty'
        else 'skipped_busy'
      end,
      (v_skip ->> 'therapist_id')::uuid,
      coalesce(v_skip ->> 'detail', 'Skipped — ' || (v_skip ->> 'reason')),
      auth.uid()
    );
  end loop;

  insert into queue_events (work_date, event_type, therapist_id, session_id, detail, actor_id, meta)
  values (
    v_date, 'received_customer', p_therapist_id, v_session.id,
    coalesce(v_svc.name_en, 'Custom') || ' — ' || p_duration_min || ' min',
    auth.uid(),
    jsonb_build_object('assignment_type', p_assignment_type, 'reason', p_assignment_reason)
  );

  if p_assignment_type <> 'queue' then
    insert into queue_events (work_date, event_type, therapist_id, session_id, detail, actor_id)
    values (v_date, 'manual_override', p_therapist_id, v_session.id,
            coalesce(p_assignment_reason, p_assignment_type), auth.uid());
  end if;

  return v_session;
end;
$$;

-- Finish a massage: sets status, records payment, releases therapist
create or replace function finish_session(
  p_session_id     uuid,
  p_finished_at    timestamptz default now(),
  p_payment_method text default null,
  p_final_price    numeric default null,
  p_actual_pay     numeric default null
)
returns massage_sessions
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_session massage_sessions;
begin
  if not is_staff() then
    raise exception 'Not authorised';
  end if;

  update massage_sessions
     set status         = 'finished',
         finished_at    = p_finished_at,
         finished_by    = auth.uid(),
         payment_method = coalesce(p_payment_method, payment_method),
         final_price    = coalesce(p_final_price, final_price),
         actual_therapist_pay = coalesce(p_actual_pay, actual_therapist_pay)
   where id = p_session_id and status = 'active'
  returning * into v_session;

  if v_session.id is null then
    raise exception 'Session not found or already closed';
  end if;

  if v_session.payment_method is not null then
    insert into payments (session_id, work_date, method, amount, received_by)
    values (v_session.id, v_session.work_date, v_session.payment_method,
            v_session.final_price, auth.uid());
  end if;

  -- Customer-request jobs may be sent to the back of the queue afterwards
  if v_session.post_job_queue_action = 'end_of_queue' then
    update daily_queue
       set position = (select coalesce(max(position), 0) + 1
                         from daily_queue where work_date = v_session.work_date)
     where work_date = v_session.work_date
       and therapist_id = v_session.therapist_id;
  end if;

  insert into queue_events (work_date, event_type, therapist_id, session_id, detail, actor_id)
  values (v_session.work_date, 'finished_massage', v_session.therapist_id, v_session.id,
          'Finished — ฿' || v_session.final_price, auth.uid());

  return v_session;
end;
$$;

-- Void (never delete)
create or replace function void_session(p_session_id uuid, p_reason text)
returns massage_sessions
language plpgsql
security invoker
set search_path = public
as $$
declare v_session massage_sessions;
begin
  if not is_owner() then
    raise exception 'Only the Owner can void a transaction';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to void a transaction';
  end if;

  update massage_sessions
     set status = 'voided', voided_at = now(), voided_by = auth.uid(), void_reason = p_reason
   where id = p_session_id
  returning * into v_session;

  insert into queue_events (work_date, event_type, therapist_id, session_id, detail, actor_id)
  values (v_session.work_date, 'voided', v_session.therapist_id, v_session.id, p_reason, auth.uid());

  return v_session;
end;
$$;

-- Extend a running (or finished-today) massage
create or replace function extend_session(
  p_session_id  uuid,
  p_minutes     integer,
  p_add_price   numeric default 0,
  p_add_pay     numeric default 0,
  p_extra_service_id uuid default null,
  p_note        text default null
)
returns massage_sessions
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_session massage_sessions;
  v_name    text;
begin
  if not is_staff() then
    raise exception 'Not authorised';
  end if;

  select name_en into v_name from services where id = p_extra_service_id;

  insert into session_extensions (session_id, added_minutes, added_price, added_therapist_pay,
                                  extra_service_id, extra_service_name, note, created_by)
  values (p_session_id, p_minutes, coalesce(p_add_price, 0), coalesce(p_add_pay, 0),
          p_extra_service_id, v_name, p_note, auth.uid());

  update massage_sessions
     set duration_min        = duration_min + p_minutes,
         expected_finish_at  = expected_finish_at + (p_minutes || ' minutes')::interval,
         original_price      = original_price + coalesce(p_add_price, 0),
         final_price         = final_price + coalesce(p_add_price, 0),
         default_therapist_pay = default_therapist_pay + coalesce(p_add_pay, 0),
         actual_therapist_pay  = actual_therapist_pay + coalesce(p_add_pay, 0)
   where id = p_session_id
  returning * into v_session;

  insert into queue_events (work_date, event_type, therapist_id, session_id, detail, actor_id)
  values (v_session.work_date, 'extended', v_session.therapist_id, v_session.id,
          '+' || p_minutes || ' min / +฿' || coalesce(p_add_price, 0), auth.uid());

  return v_session;
end;
$$;

-- Close the day: freeze a snapshot
create or replace function close_day(p_work_date date default app_today(), p_note text default null)
returns daily_closings
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row daily_closings;
  v_fin record;
  v_snapshot jsonb;
begin
  if not is_owner() then
    raise exception 'Only the Owner can close the day';
  end if;

  if exists (select 1 from massage_sessions where work_date = p_work_date and status = 'active') then
    raise exception 'There are still active massages. Finish them before closing the day.';
  end if;

  select * into v_fin from v_daily_financials where work_date = p_work_date;

  select jsonb_build_object(
    'therapists', coalesce((
      select jsonb_agg(jsonb_build_object(
        'therapist_id', st.therapist_id,
        'name', t.name,
        'nickname', t.nickname,
        'jobs', st.jobs,
        'minutes_worked', st.minutes_worked,
        'sales_generated', st.sales_generated,
        'therapist_pay', st.therapist_pay,
        'shop_revenue', st.shop_revenue,
        'discount_given', st.discount_given,
        'customer_requests', st.customer_requests,
        'busy_skips', st.busy_skips,
        'outside_job_count', st.outside_job_count
      ) order by st.jobs desc)
      from v_therapist_daily_stats st
      join therapists t on t.id = st.therapist_id
      where st.work_date = p_work_date
    ), '[]'::jsonb),
    'transactions', coalesce((
      select jsonb_agg(to_jsonb(v) order by v.start_at)
      from v_transactions v where v.work_date = p_work_date
    ), '[]'::jsonb)
  ) into v_snapshot;

  insert into daily_closings (
    work_date, closed_by, total_customers, total_jobs, gross_sales, original_value,
    total_discount, therapist_wages, net_shop_revenue,
    cash_total, qr_total, card_total, other_total, snapshot, note
  ) values (
    p_work_date, auth.uid(),
    coalesce(v_fin.total_customers, 0), coalesce(v_fin.total_jobs, 0),
    coalesce(v_fin.gross_sales, 0), coalesce(v_fin.original_value, 0),
    coalesce(v_fin.total_discount, 0), coalesce(v_fin.therapist_wages, 0),
    coalesce(v_fin.net_shop_revenue, 0),
    coalesce(v_fin.cash_total, 0), coalesce(v_fin.qr_total, 0),
    coalesce(v_fin.card_total, 0), coalesce(v_fin.other_total, 0),
    v_snapshot, p_note
  )
  on conflict (work_date) do update set
    closed_at = now(), closed_by = auth.uid(),
    total_customers = excluded.total_customers, total_jobs = excluded.total_jobs,
    gross_sales = excluded.gross_sales, original_value = excluded.original_value,
    total_discount = excluded.total_discount, therapist_wages = excluded.therapist_wages,
    net_shop_revenue = excluded.net_shop_revenue,
    cash_total = excluded.cash_total, qr_total = excluded.qr_total,
    card_total = excluded.card_total, other_total = excluded.other_total,
    snapshot = excluded.snapshot, note = excluded.note
  returning * into v_row;

  insert into queue_events (work_date, event_type, detail, actor_id)
  values (p_work_date, 'day_closed', 'Net ฿' || v_row.net_shop_revenue, auth.uid());

  return v_row;
end;
$$;

-- Reorder the queue in one call (array of therapist ids in the new order)
create or replace function reorder_queue(p_work_date date, p_therapist_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare i int;
begin
  if not is_staff() then
    raise exception 'Not authorised';
  end if;
  for i in 1 .. array_length(p_therapist_ids, 1) loop
    update daily_queue
       set position = i
     where work_date = p_work_date and therapist_id = p_therapist_ids[i];
  end loop;
  insert into queue_events (work_date, event_type, detail, actor_id)
  values (p_work_date, 'reordered', 'Queue order updated', auth.uid());
end;
$$;

-- ============================================================================
-- 14. ROW LEVEL SECURITY
-- ============================================================================

alter table profiles           enable row level security;
alter table therapists         enable row level security;
alter table services           enable row level security;
alter table daily_queue        enable row level security;
alter table queue_state        enable row level security;
alter table outside_job_logs   enable row level security;
alter table massage_sessions   enable row level security;
alter table session_extensions enable row level security;
alter table payments           enable row level security;
alter table waiting_customers  enable row level security;
alter table queue_events       enable row level security;
alter table daily_closings     enable row level security;
alter table audit_logs         enable row level security;

-- profiles
drop policy if exists profiles_read on profiles;
create policy profiles_read on profiles for select using (is_staff());
drop policy if exists profiles_self_update on profiles;
create policy profiles_self_update on profiles for update using (id = auth.uid()) with check (id = auth.uid() and role = (select role from profiles p where p.id = auth.uid()));
drop policy if exists profiles_owner_all on profiles;
create policy profiles_owner_all on profiles for all using (is_owner()) with check (is_owner());

-- Read-for-all-staff tables
do $$
declare t text;
begin
  foreach t in array array['therapists', 'services', 'daily_queue', 'queue_state',
                           'outside_job_logs', 'massage_sessions', 'session_extensions',
                           'payments', 'waiting_customers', 'queue_events', 'daily_closings'] loop
    execute format('drop policy if exists %1$s_read on %1$s', t);
    execute format('create policy %1$s_read on %1$s for select using (is_staff())', t);
  end loop;
end $$;

-- Operational writes: any active staff member
do $$
declare t text;
begin
  foreach t in array array['daily_queue', 'queue_state', 'outside_job_logs',
                           'massage_sessions', 'session_extensions', 'payments',
                           'waiting_customers', 'queue_events'] loop
    execute format('drop policy if exists %1$s_insert on %1$s', t);
    execute format('create policy %1$s_insert on %1$s for insert with check (is_staff())', t);
  end loop;

  foreach t in array array['daily_queue', 'queue_state', 'outside_job_logs',
                           'session_extensions', 'waiting_customers', 'queue_events'] loop
    execute format('drop policy if exists %1$s_update on %1$s', t);
    execute format('create policy %1$s_update on %1$s for update using (is_staff()) with check (is_staff())', t);
  end loop;
end $$;

-- Money rows: Reception may only touch a job that is STILL RUNNING
-- (start / extend / finish). Once it is finished or voided, only the Owner
-- can change it — and every change lands in audit_logs.
drop policy if exists sessions_update_staff_active on massage_sessions;
create policy sessions_update_staff_active on massage_sessions
  for update using (is_staff() and status = 'active') with check (is_staff());

drop policy if exists sessions_update_owner on massage_sessions;
create policy sessions_update_owner on massage_sessions
  for update using (is_owner()) with check (is_owner());

drop policy if exists payments_update_owner on payments;
create policy payments_update_owner on payments
  for update using (is_owner()) with check (is_owner());

-- Reception can un-check-in a therapist (queue rows only) before jobs exist
drop policy if exists daily_queue_delete on daily_queue;
create policy daily_queue_delete on daily_queue for delete using (
  is_staff() and not exists (
    select 1 from massage_sessions s
    where s.work_date = daily_queue.work_date
      and s.therapist_id = daily_queue.therapist_id
  )
);

-- Settings (services, therapists) + closings: Owner only
do $$
declare t text;
begin
  foreach t in array array['services', 'therapists', 'daily_closings'] loop
    execute format('drop policy if exists %1$s_owner_write on %1$s', t);
    execute format('create policy %1$s_owner_write on %1$s for all using (is_owner()) with check (is_owner())', t);
  end loop;
end $$;

-- Audit log: Owner reads, nobody writes directly (triggers are security definer)
drop policy if exists audit_owner_read on audit_logs;
create policy audit_owner_read on audit_logs for select using (is_owner());

-- Views must honour the caller's RLS, not the view owner's.
alter view v_transactions            set (security_invoker = true);
alter view v_therapist_daily_stats   set (security_invoker = true);
alter view v_daily_financials        set (security_invoker = true);

-- Explicit grants (Supabase normally adds these by default — being explicit
-- means this file also works when applied by a different role).
grant usage on schema public to anon, authenticated;
grant select, insert, update on all tables in schema public to authenticated;
grant delete on daily_queue, waiting_customers, services, therapists to authenticated;
grant select on v_transactions, v_therapist_daily_stats, v_daily_financials to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

-- ============================================================================
-- 15. REALTIME
-- ============================================================================

do $$
begin
  begin
    alter publication supabase_realtime add table massage_sessions;
  exception when duplicate_object then null; end;
  begin
    alter publication supabase_realtime add table daily_queue;
  exception when duplicate_object then null; end;
  begin
    alter publication supabase_realtime add table queue_state;
  exception when duplicate_object then null; end;
  begin
    alter publication supabase_realtime add table queue_events;
  exception when duplicate_object then null; end;
  begin
    alter publication supabase_realtime add table waiting_customers;
  exception when duplicate_object then null; end;
  begin
    alter publication supabase_realtime add table therapists;
  exception when duplicate_object then null; end;
  begin
    alter publication supabase_realtime add table services;
  exception when duplicate_object then null; end;
end $$;
