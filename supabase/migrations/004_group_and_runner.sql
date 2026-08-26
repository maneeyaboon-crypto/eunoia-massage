-- ============================================================================
-- EUNOIA Massage — Migration 004
-- 1) รับลูกค้าเป็นกลุ่ม: ใส่จำนวนลูกค้าก่อน แล้วจ่ายหมอนวด 1 คนต่อลูกค้า 1 คน
-- 2) หมอวิ่ง: หมอนวดนอกร้านที่เรียกเข้ามาเสริมเมื่อคนในร้านไม่พอ
-- รันไฟล์นี้หลัง 001 และ 002  (ปลอดภัยถ้ารันซ้ำ)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. หมอวิ่ง
-- ---------------------------------------------------------------------------

alter table therapists
  add column if not exists is_runner boolean not null default false;

comment on column therapists.is_runner is
  'true = หมอวิ่ง (หมอนวดนอกร้าน เรียกเข้ามาเสริมตอนคนในร้านไม่พอ) — ไม่ได้อยู่ในรายชื่อประจำร้าน';

alter table daily_queue
  add column if not exists entry_type text not null default 'regular';

do $$ begin
  alter table daily_queue
    add constraint daily_queue_entry_type_chk check (entry_type in ('regular', 'runner'));
exception when duplicate_object then null; end $$;

comment on column daily_queue.entry_type is
  'regular = หมอนวดประจำที่ลงคิวเอง · runner = หมอวิ่งที่ถูกเรียกเข้ามาวันนี้';

-- ---------------------------------------------------------------------------
-- 2. กลุ่มลูกค้า (ลูกค้าที่เดินเข้ามาพร้อมกัน)
-- ---------------------------------------------------------------------------

create sequence if not exists group_code_seq;

alter table massage_sessions
  add column if not exists group_code    text,
  add column if not exists group_size    integer not null default 1,
  add column if not exists group_index   integer not null default 1,
  add column if not exists is_runner_job boolean not null default false;

comment on column massage_sessions.group_code is
  'ลูกค้าที่เข้ามาพร้อมกันจะใช้รหัสกลุ่มเดียวกัน — 1 แถว = 1 ลูกค้า = หมอนวด 1 คน';
comment on column massage_sessions.is_runner_job is
  'true = งานนี้จ่ายให้หมอวิ่ง (คนในร้านไม่พอ)';

create index if not exists sessions_group_idx on massage_sessions (group_code);

-- ---------------------------------------------------------------------------
-- 3. เหตุการณ์ใหม่ในไทม์ไลน์
-- ---------------------------------------------------------------------------

do $$
begin
  alter table queue_events drop constraint if exists queue_events_event_type_check;
  alter table queue_events add constraint queue_events_event_type_check
    check (event_type in (
      'check_in', 'received_customer', 'skipped_busy', 'skipped_break',
      'skipped_outside', 'skipped_off_duty', 'finished_massage',
      'outside_job_start', 'outside_job_return', 'status_change',
      'manual_override', 'extended', 'reordered', 'voided', 'day_closed',
      -- ใหม่
      'group_received', 'runner_called', 'runner_shortage'
    ));
end $$;

-- ---------------------------------------------------------------------------
-- 4. เรียกหมอวิ่งเข้ามา
--    security definer เพราะพนักงานหน้าร้านต้องเรียกหมอวิ่งได้เอง
--    (ปกติการเพิ่มหมอนวดเป็นสิทธิ์ของเจ้าของร้านเท่านั้น)
-- ---------------------------------------------------------------------------

-- เผื่อกรณีรันไฟล์ 005 มาก่อนแล้วรัน 004 ซ้ำ (ค่า default ของพารามิเตอร์ต่างกัน)
drop function if exists add_runner(text, text, date);

create or replace function add_runner(
  p_name      text,
  p_phone     text default null,
  p_work_date date default null
)
returns therapists
language plpgsql
security definer
set search_path = public
as $$
declare
  v_date date := coalesce(p_work_date, app_today());
  v_name text := trim(p_name);
  v_th   therapists;
  v_pos  integer;
begin
  if not is_staff() then
    raise exception 'Not authorised';
  end if;
  if coalesce(v_name, '') = '' then
    raise exception 'กรุณาใส่ชื่อหมอวิ่ง';
  end if;

  select * into v_th from therapists where name = v_name;

  if v_th.id is null then
    insert into therapists (name, phone, is_active, is_runner, notes)
    values (v_name, p_phone, true, true, 'หมอวิ่ง — เพิ่มจากหน้ารับลูกค้า')
    returning * into v_th;
  elsif not v_th.is_active then
    update therapists set is_active = true where id = v_th.id returning * into v_th;
  end if;

  -- ลงคิววันนี้ให้เลย (ต่อท้ายคิว) ถ้ายังไม่ได้ลง
  if not exists (select 1 from daily_queue where work_date = v_date and therapist_id = v_th.id) then
    select coalesce(max(position), 0) + 1 into v_pos from daily_queue where work_date = v_date;
    insert into daily_queue (work_date, therapist_id, position, status, entry_type, checked_in_by, note)
    values (v_date, v_th.id, v_pos, 'available',
            case when v_th.is_runner then 'runner' else 'regular' end,
            auth.uid(), case when v_th.is_runner then 'หมอวิ่ง' else null end);

    insert into queue_events (work_date, event_type, therapist_id, detail, actor_id)
    values (v_date, 'runner_called', v_th.id, 'เรียกหมอวิ่งเข้ามา — คิว #' || v_pos, auth.uid());
  end if;

  return v_th;
end;
$$;

revoke all on function add_runner(text, text, date) from public;
grant execute on function add_runner(text, text, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. รับลูกค้าเป็นกลุ่ม — สร้างทุกรายการในครั้งเดียว (atomic)
--    p_assignments = [{ therapist_id, service_id, duration_min, original_price,
--                       final_price, default_pay, actual_pay, customer_name,
--                       note, assignment_type, assignment_reason,
--                       is_customer_request, post_job_action, is_runner_job }, ...]
-- ---------------------------------------------------------------------------

create or replace function start_group(
  p_assignments jsonb,
  p_start_at    timestamptz default now(),
  p_skipped     jsonb default '[]'::jsonb,
  p_shortage    integer default 0
)
returns setof massage_sessions
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_date     date := (p_start_at at time zone 'Asia/Bangkok')::date;
  v_group    text;
  v_size     integer := jsonb_array_length(coalesce(p_assignments, '[]'::jsonb));
  v_a        jsonb;
  v_i        integer := 0;
  v_svc      services;
  v_session  massage_sessions;
  v_last     uuid;
  v_skip     jsonb;
  v_dur      integer;
begin
  if not is_staff() then
    raise exception 'Not authorised';
  end if;
  if v_size = 0 then
    raise exception 'ไม่มีรายการที่จะบันทึก';
  end if;

  v_group := 'G-' || to_char(v_date, 'YYYYMMDD') || '-' ||
             lpad(nextval('group_code_seq')::text, 4, '0');

  -- บันทึกการถูกข้ามครั้งเดียวต่อกลุ่ม (ไม่ทบตามจำนวนลูกค้า)
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
      coalesce(v_skip ->> 'detail', 'ข้าม'),
      auth.uid()
    );
  end loop;

  for v_a in select * from jsonb_array_elements(p_assignments) loop
    v_i := v_i + 1;

    if not exists (
      select 1 from daily_queue
      where work_date = v_date and therapist_id = (v_a ->> 'therapist_id')::uuid
    ) then
      raise exception 'หมอนวดยังไม่ได้ลงคิวของวันที่ %', v_date;
    end if;

    select * into v_svc from services where id = (v_a ->> 'service_id')::uuid;
    v_dur := coalesce((v_a ->> 'duration_min')::integer, v_svc.duration_min);

    insert into massage_sessions (
      work_date, therapist_id, service_id, service_name_en, service_name_th,
      base_duration_min, duration_min, customer_name, customer_count, note,
      start_at, expected_finish_at, original_price, final_price,
      default_therapist_pay, actual_therapist_pay,
      assignment_type, assignment_reason, is_customer_request, post_job_queue_action,
      group_code, group_size, group_index, is_runner_job, created_by
    ) values (
      v_date,
      (v_a ->> 'therapist_id')::uuid,
      (v_a ->> 'service_id')::uuid,
      coalesce(v_svc.name_en, 'บริการ'), v_svc.name_th,
      v_dur, v_dur,
      nullif(trim(coalesce(v_a ->> 'customer_name', '')), ''),
      1,
      nullif(trim(coalesce(v_a ->> 'note', '')), ''),
      p_start_at, p_start_at + (v_dur || ' minutes')::interval,
      coalesce((v_a ->> 'original_price')::numeric, 0),
      coalesce((v_a ->> 'final_price')::numeric, 0),
      coalesce((v_a ->> 'default_pay')::numeric, 0),
      coalesce((v_a ->> 'actual_pay')::numeric, 0),
      coalesce(v_a ->> 'assignment_type', 'queue'),
      nullif(trim(coalesce(v_a ->> 'assignment_reason', '')), ''),
      coalesce((v_a ->> 'is_customer_request')::boolean, false),
      coalesce(v_a ->> 'post_job_action', 'rotation'),
      v_group, v_size, v_i,
      coalesce((v_a ->> 'is_runner_job')::boolean, false),
      auth.uid()
    )
    returning * into v_session;

    -- ตัวชี้คิวขยับไปที่หมอนวดประจำคนสุดท้ายที่ได้งาน (หมอวิ่งไม่นับในรอบคิว)
    if not coalesce((v_a ->> 'is_runner_job')::boolean, false) then
      v_last := v_session.therapist_id;
    end if;

    insert into queue_events (work_date, event_type, therapist_id, session_id, detail, actor_id, meta)
    values (
      v_date, 'received_customer', v_session.therapist_id, v_session.id,
      v_session.service_name_th || ' — ' || v_dur || ' นาที' ||
        case when v_size > 1 then ' (กลุ่ม ' || v_size || ' คน · คนที่ ' || v_i || ')' else '' end,
      auth.uid(),
      jsonb_build_object('group_code', v_group, 'is_runner_job', v_session.is_runner_job)
    );

    if v_session.assignment_type <> 'queue' then
      insert into queue_events (work_date, event_type, therapist_id, session_id, detail, actor_id)
      values (v_date, 'manual_override', v_session.therapist_id, v_session.id,
              coalesce(v_session.assignment_reason, v_session.assignment_type), auth.uid());
    end if;

    return next v_session;
  end loop;

  if v_last is not null then
    insert into queue_state (work_date, last_assigned_therapist_id, updated_at)
    values (v_date, v_last, now())
    on conflict (work_date) do update
      set last_assigned_therapist_id = excluded.last_assigned_therapist_id,
          updated_at = now();
  end if;

  if v_size > 1 then
    insert into queue_events (work_date, event_type, detail, actor_id, meta)
    values (v_date, 'group_received', 'รับลูกค้า ' || v_size || ' คนพร้อมกัน', auth.uid(),
            jsonb_build_object('group_code', v_group, 'size', v_size));
  end if;

  if coalesce(p_shortage, 0) > 0 then
    insert into queue_events (work_date, event_type, detail, actor_id)
    values (v_date, 'runner_shortage',
            'หมอนวดในร้านไม่พอ ขาดอีก ' || p_shortage || ' คน', auth.uid());
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. สถิติหมอวิ่ง — เพิ่มเข้าไปใน view เดิม
-- ---------------------------------------------------------------------------

-- ต้อง drop ก่อน เพราะเพิ่มคอลัมน์กลางลำดับ (create or replace เปลี่ยนชื่อคอลัมน์ไม่ได้)
drop view if exists v_therapist_daily_stats;
create view v_therapist_daily_stats as
with jobs as (
  select
    s.work_date,
    s.therapist_id,
    count(*)                                             as jobs,
    sum(s.duration_min)                                  as minutes_worked,
    sum(s.final_price)                                   as sales_generated,
    sum(s.original_price)                                as original_value,
    sum(s.discount)                                      as discount_given,
    sum(s.actual_therapist_pay)                          as therapist_pay,
    sum(s.shop_revenue)                                  as shop_revenue,
    count(*) filter (where s.is_customer_request)         as customer_requests,
    count(*) filter (where s.assignment_type = 'manual')  as manual_assignments,
    count(*) filter (where s.is_runner_job)               as runner_jobs
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
  coalesce(j.work_date, sk.work_date, o.work_date)          as work_date,
  coalesce(j.therapist_id, sk.therapist_id, o.therapist_id) as therapist_id,
  coalesce(j.jobs, 0)               as jobs,
  coalesce(j.minutes_worked, 0)     as minutes_worked,
  coalesce(j.sales_generated, 0)    as sales_generated,
  coalesce(j.original_value, 0)     as original_value,
  coalesce(j.discount_given, 0)     as discount_given,
  coalesce(j.therapist_pay, 0)      as therapist_pay,
  coalesce(j.shop_revenue, 0)       as shop_revenue,
  coalesce(j.customer_requests, 0)  as customer_requests,
  coalesce(j.manual_assignments, 0) as manual_assignments,
  coalesce(j.runner_jobs, 0)        as runner_jobs,
  coalesce(sk.busy_skips, 0)        as busy_skips,
  coalesce(o.outside_job_count, 0)  as outside_job_count
from jobs j
full outer join skips sk on sk.work_date = j.work_date and sk.therapist_id = j.therapist_id
full outer join outside o on o.work_date = coalesce(j.work_date, sk.work_date)
                         and o.therapist_id = coalesce(j.therapist_id, sk.therapist_id);

alter view v_therapist_daily_stats set (security_invoker = true);

-- v_transactions: เพิ่มข้อมูลกลุ่มและหมอวิ่ง
drop view if exists v_transactions;
create view v_transactions as
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
  t.is_runner           as therapist_is_runner,
  s.service_name_en,
  s.service_name_th,
  s.duration_min,
  s.customer_name,
  s.customer_count,
  s.group_code,
  s.group_size,
  s.group_index,
  s.is_runner_job,
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

alter view v_transactions set (security_invoker = true);

grant select on v_transactions, v_therapist_daily_stats to authenticated;

-- ---------------------------------------------------------------------------
-- 7. ปิดกลุ่มพร้อมกัน (ลูกค้ากลุ่มเดียวกันมักจ่ายเงินรวมกัน)
-- ---------------------------------------------------------------------------

create or replace function finish_group(
  p_group_code     text,
  p_finished_at    timestamptz default now(),
  p_payment_method text default null
)
returns setof massage_sessions
language plpgsql
security invoker
set search_path = public
as $$
declare r record;
begin
  if not is_staff() then
    raise exception 'Not authorised';
  end if;
  for r in
    select id from massage_sessions
    where group_code = p_group_code and status = 'active'
    order by group_index
  loop
    return next finish_session(r.id, p_finished_at, p_payment_method);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. หมอวิ่งตัวอย่าง (ยังไม่ลงคิว — ไว้ให้เลือกเวลาคนไม่พอ)
-- ---------------------------------------------------------------------------

insert into therapists (name, phone, is_active, is_runner, notes)
values
  ('พี่นก (หมอวิ่ง)',  '089-000-0011', true, true, 'หมอวิ่ง — โทรเรียกได้ ปกติมาถึงใน 15 นาที'),
  ('พี่แดง (หมอวิ่ง)', '089-000-0012', true, true, 'หมอวิ่ง — ว่างช่วงเย็น')
on conflict (name) do nothing;
