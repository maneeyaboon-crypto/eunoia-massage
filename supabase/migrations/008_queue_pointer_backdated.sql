-- ============================================================================
-- EUNOIA Massage — Migration 008
-- คิวเดินให้ถูกต้องแม้กรอกย้อนหลังและมีการยกเลิก
--
--  1) ตัวชี้คิว (คิวถัดไป) ไม่ได้ "จำค่าที่เคยตั้งไว้" อีกต่อไป แต่ **คำนวณใหม่ทุกครั้ง**
--     จากรายการนวดจริงของวันนั้น = หมอนวดของรายการล่าสุดที่ยังไม่ถูกยกเลิก
--     → ยกเลิกรายการที่กรอกผิด คิวเด้งกลับเป็นคนเดิมให้อัตโนมัติ
--
--  2) งานย้อนหลัง: ถ้าเวลาที่กรอกจบไปแล้ว บันทึกเป็น "เสร็จแล้ว" ทันที
--     หมอนวดไม่ถูกจับเป็น "กำลังนวด" แต่ **คิวยังเดินตามปกติ**
--     (เพราะการกรอกย้อนหลังคือการบันทึกลำดับคิวจริงที่เกิดขึ้นแล้ว)
--
--  3) พนักงานหน้าร้านยกเลิกรายการของ "วันนี้" ได้เอง (ต้องใส่เหตุผล บันทึกทุกครั้ง)
--     เจ้าของร้านยกเลิกได้ทุกวันเหมือนเดิม · ไม่มีการลบข้อมูลออกจากระบบ
--
--  4) ปุ่มกันเหนียว: เจ้าของร้านตั้ง "คิวถัดไป" เป็นใครก็ได้ด้วยตัวเอง
--
-- รันหลัง 001 → 002 → 004 → 005 → 006 → 007   (ปลอดภัยถ้ารันซ้ำ)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. ธงบอกว่ารายการนี้กรอกย้อนหลัง
-- ---------------------------------------------------------------------------

alter table massage_sessions
  add column if not exists is_backdated boolean not null default false;

comment on column massage_sessions.is_backdated is
  'true = กรอกย้อนหลัง (เวลาที่นวดจบไปแล้วตอนที่บันทึก) — บันทึกเป็นเสร็จแล้วทันที คิวยังเดินตามลำดับที่กรอก';

do $$
begin
  alter table queue_events drop constraint if exists queue_events_event_type_check;
  alter table queue_events add constraint queue_events_event_type_check
    check (event_type in (
      'check_in', 'received_customer', 'skipped_busy', 'skipped_break',
      'skipped_outside', 'skipped_off_duty', 'finished_massage',
      'outside_job_start', 'outside_job_return', 'status_change',
      'manual_override', 'extended', 'reordered', 'voided', 'day_closed',
      'group_received', 'runner_called', 'runner_shortage',
      'auto_finished', 'session_edited', 'sheets_synced',
      -- ใหม่
      'pointer_set'
    ));
end $$;

-- ---------------------------------------------------------------------------
-- 2. หัวใจ: คำนวณ "คิวถัดไป" ใหม่จากรายการจริง
--
--    ตัวชี้คิว = หมอนวดของรายการล่าสุดของวันนั้นที่
--       • ยังไม่ถูกยกเลิก
--       • ไม่ใช่งานของหมอวิ่ง (หมอวิ่งไม่กินคิวหมอประจำ)
--    เรียงตามเวลาที่เริ่มนวดจริง ถ้าเวลาเท่ากันใช้ลำดับที่บันทึก (รหัสรายการ)
--
--    ตัวอย่างของร้าน: กุ้ง #1 · รัน #2 · แพรว #3
--    กรอกย้อนหลัง 3 คน → ตัวชี้คิวอยู่ที่แพรว
--    ยกเลิกของแพรว (กรอกเกิน) → ตัวชี้คิวกลับไปที่รันเอง
--    → ลูกค้าคนถัดไปตกที่ "แพรว" คนเดิม ✔
-- ---------------------------------------------------------------------------

create or replace function recompute_queue_pointer(p_work_date date default app_today())
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_last uuid;
begin
  select s.therapist_id
    into v_last
    from massage_sessions s
   where s.work_date = p_work_date
     and s.status <> 'voided'
     and not coalesce(s.is_runner_job, false)
   order by s.start_at desc, s.code desc   -- รหัสรายการเรียงตามลำดับที่บันทึก
   limit 1;

  insert into queue_state (work_date, last_assigned_therapist_id, updated_at)
  values (p_work_date, v_last, now())
  on conflict (work_date) do update
    set last_assigned_therapist_id = excluded.last_assigned_therapist_id,
        updated_at = now();

  return v_last;
end;
$$;

comment on function recompute_queue_pointer(date) is
  'คำนวณ "คิวถัดไป" ใหม่จากรายการนวดจริงของวันนั้น — เรียกทุกครั้งที่รับลูกค้า ยกเลิก หรือแก้ไขรายการ';

grant execute on function recompute_queue_pointer(date) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. ตั้งคิวถัดไปเอง (เจ้าของร้านเท่านั้น) — ไว้กู้สถานการณ์ถ้าคิวเพี้ยน
-- ---------------------------------------------------------------------------

create or replace function set_queue_pointer(
  p_therapist_id uuid,
  p_work_date    date default app_today(),
  p_reason       text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not is_owner() then
    raise exception 'เฉพาะเจ้าของร้านเท่านั้นที่ตั้งคิวถัดไปเองได้';
  end if;

  if p_therapist_id is not null and not exists (
    select 1 from daily_queue where work_date = p_work_date and therapist_id = p_therapist_id
  ) then
    raise exception 'หมอนวดคนนี้ยังไม่ได้ลงคิวของวันนั้น';
  end if;

  insert into queue_state (work_date, last_assigned_therapist_id, updated_at)
  values (p_work_date, p_therapist_id, now())
  on conflict (work_date) do update
    set last_assigned_therapist_id = excluded.last_assigned_therapist_id,
        updated_at = now();

  insert into queue_events (work_date, event_type, therapist_id, detail, actor_id)
  values (p_work_date, 'pointer_set', p_therapist_id,
          coalesce(nullif(trim(p_reason), ''), 'ตั้งคิวถัดไปเอง'), auth.uid());

  return p_therapist_id;
end;
$$;

grant execute on function set_queue_pointer(uuid, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. ยกเลิกรายการ — พนักงานหน้าร้านยกเลิกของ "วันนี้" ได้ + คืนคิวให้อัตโนมัติ
-- ---------------------------------------------------------------------------

create or replace function void_session(p_session_id uuid, p_reason text)
returns massage_sessions
language plpgsql
security invoker
set search_path = public
as $$
declare v_session massage_sessions;
begin
  select * into v_session from massage_sessions where id = p_session_id;
  if v_session.id is null then
    raise exception 'ไม่พบรายการนี้';
  end if;

  if v_session.status = 'voided' then
    raise exception 'รายการนี้ถูกยกเลิกไปแล้ว';
  end if;

  -- เจ้าของร้านยกเลิกได้ทุกวัน · พนักงานหน้าร้านยกเลิกได้เฉพาะรายการของวันนี้
  if not is_owner() then
    if not is_staff() then
      raise exception 'ไม่มีสิทธิ์ยกเลิกรายการ';
    end if;
    if v_session.work_date <> app_today() then
      raise exception 'พนักงานหน้าร้านยกเลิกได้เฉพาะรายการของวันนี้ — รายการย้อนหลังต้องให้เจ้าของร้านยกเลิก';
    end if;
    if exists (select 1 from daily_closings where work_date = v_session.work_date) then
      raise exception 'วันนี้ปิดยอดแล้ว — เฉพาะเจ้าของร้านเท่านั้นที่แก้ไขได้';
    end if;
  end if;

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'ต้องใส่เหตุผลที่ยกเลิก';
  end if;

  update massage_sessions
     set status = 'voided', voided_at = now(), voided_by = auth.uid(), void_reason = p_reason
   where id = p_session_id
  returning * into v_session;

  insert into queue_events (work_date, event_type, therapist_id, session_id, detail, actor_id)
  values (v_session.work_date, 'voided', v_session.therapist_id, v_session.id, p_reason, auth.uid());

  -- คืนคิว: คำนวณตัวชี้คิวใหม่จากรายการที่เหลือ
  perform recompute_queue_pointer(v_session.work_date);

  return v_session;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. รับลูกค้า / รับเป็นกลุ่ม / แก้ไขรายการ — ใช้ตัวชี้คิวแบบคำนวณใหม่
--    และรองรับงานย้อนหลัง
-- ---------------------------------------------------------------------------

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

  -- งานย้อนหลัง: ถ้าเวลาที่กรอกจบไปแล้ว บันทึกเป็น "เสร็จแล้ว" ทันที
  -- หมอนวดจะไม่ถูกจับเป็น "กำลังนวด" เพราะงานนี้เกิดขึ้นและจบไปแล้วจริง
  if v_session.expected_finish_at <= now() then
    update massage_sessions
       set status       = 'finished',
           finished_at  = v_session.expected_finish_at,
           finished_by  = auth.uid(),
           is_backdated = true
     where id = v_session.id
    returning * into v_session;
  end if;

  -- ตัวชี้คิวคำนวณใหม่จากรายการจริงเสมอ (ยกเลิกแล้วคิวคืนให้เอง)
  perform recompute_queue_pointer(v_date);

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

    -- งานย้อนหลัง: ถ้าเวลาที่กรอกจบไปแล้ว บันทึกเป็น "เสร็จแล้ว" ทันที
    -- หมอนวดจะไม่ถูกจับเป็น "กำลังนวด" เพราะงานนี้เกิดขึ้นและจบไปแล้วจริง
    if v_session.expected_finish_at <= now() then
      update massage_sessions
         set status       = 'finished',
             finished_at  = v_session.expected_finish_at,
             finished_by  = auth.uid(),
             is_backdated = true
       where id = v_session.id
      returning * into v_session;
    end if;

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

  -- ตัวชี้คิวคำนวณใหม่จากรายการจริงเสมอ
  perform recompute_queue_pointer(v_date);

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

create or replace function update_session(
  p_session_id     uuid,
  p_service_id     uuid        default null,
  p_therapist_id   uuid        default null,
  p_start_at       timestamptz default null,
  p_duration_min   integer     default null,
  p_customer_name  text        default null,
  p_final_price    numeric     default null,
  p_actual_pay     numeric     default null,
  p_original_price numeric     default null,
  p_payment_method text        default null,
  p_note           text        default null,
  p_reason         text        default null
)
returns massage_sessions
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_old  massage_sessions;
  v_new  massage_sessions;
  v_svc  services;
  v_dur  integer;
  v_start timestamptz;
begin
  select * into v_old from massage_sessions where id = p_session_id;
  if v_old.id is null then
    raise exception 'ไม่พบรายการนี้';
  end if;
  if v_old.status = 'voided' then
    raise exception 'รายการนี้ถูกยกเลิกแล้ว แก้ไขไม่ได้';
  end if;

  -- พนักงานหน้าร้านแก้ได้เฉพาะงานที่ยังนวดอยู่ · เจ้าของร้านแก้ได้ทุกงาน
  -- พนักงานหน้าร้านแก้ได้: รายการที่ยังนวดอยู่ หรือรายการของ "วันนี้" ที่ยังไม่ปิดยอด
  -- (จำเป็นสำหรับร้านที่กรอกย้อนหลัง เพราะรายการย้อนหลังจะถูกบันทึกเป็น "เสร็จแล้ว" ทันที)
  if not is_owner()
     and v_old.status <> 'active'
     and (v_old.work_date <> app_today()
          or exists (select 1 from daily_closings where work_date = v_old.work_date)) then
    raise exception 'รายการของวันก่อนหน้า หรือวันที่ปิดยอดแล้ว เฉพาะเจ้าของร้านเท่านั้นที่แก้ไขได้';
  end if;
  if not is_staff() then
    raise exception 'Not authorised';
  end if;

  -- เปลี่ยนหมอนวด: ต้องลงคิววันนั้น และต้องไม่ติดงานอื่นอยู่
  if p_therapist_id is not null and p_therapist_id <> v_old.therapist_id then
    if not exists (
      select 1 from daily_queue
      where work_date = v_old.work_date and therapist_id = p_therapist_id
    ) then
      raise exception 'หมอนวดคนนี้ยังไม่ได้ลงคิวของวันนั้น';
    end if;
    if v_old.status = 'active' and exists (
      select 1 from massage_sessions
      where therapist_id = p_therapist_id and status = 'active' and id <> p_session_id
    ) then
      raise exception 'หมอนวดคนนี้กำลังนวดลูกค้าอีกคนอยู่';
    end if;
  end if;

  v_start := coalesce(p_start_at, v_old.start_at);
  v_dur   := coalesce(p_duration_min, v_old.duration_min);
  if v_dur <= 0 then
    raise exception 'ระยะเวลาต้องมากกว่า 0 นาที';
  end if;

  if p_service_id is not null then
    select * into v_svc from services where id = p_service_id;
    if v_svc.id is null then
      raise exception 'ไม่พบบริการที่เลือก';
    end if;
  end if;

  update massage_sessions
     set service_id         = coalesce(p_service_id, service_id),
         service_name_en    = coalesce(v_svc.name_en, service_name_en),
         service_name_th    = case when p_service_id is null then service_name_th else v_svc.name_th end,
         therapist_id       = coalesce(p_therapist_id, therapist_id),
         is_runner_job      = case
                                when p_therapist_id is null then is_runner_job
                                else coalesce((select is_runner from therapists where id = p_therapist_id), false)
                              end,
         start_at           = v_start,
         duration_min       = v_dur,
         expected_finish_at = v_start + (v_dur || ' minutes')::interval,
         finished_at        = case
                                when status = 'active' then finished_at
                                else greatest(v_start + (v_dur || ' minutes')::interval, v_start)
                              end,
         customer_name      = coalesce(nullif(trim(coalesce(p_customer_name, '')), ''), customer_name),
         original_price     = coalesce(p_original_price, original_price),
         final_price        = coalesce(p_final_price, final_price),
         actual_therapist_pay = coalesce(p_actual_pay, actual_therapist_pay),
         payment_method     = coalesce(p_payment_method, payment_method),
         note               = coalesce(nullif(trim(coalesce(p_note, '')), ''), note)
   where id = p_session_id
  returning * into v_new;

  insert into queue_events (work_date, event_type, therapist_id, session_id, detail, actor_id, meta)
  values (
    v_new.work_date, 'session_edited', v_new.therapist_id, v_new.id,
    coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'แก้ไขรายการ') ||
      case when p_therapist_id is not null and p_therapist_id <> v_old.therapist_id
           then ' · เปลี่ยนหมอนวดจาก ' ||
                coalesce((select name from therapists where id = v_old.therapist_id), '—')
           else '' end,
    auth.uid(),
    jsonb_build_object('code', v_new.code, 'reason', p_reason)
  );

  -- เวลาเริ่ม/หมอนวดอาจเปลี่ยน — คำนวณตัวชี้คิวใหม่
  perform recompute_queue_pointer(v_new.work_date);

  return v_new;
end;
$$;


-- ---------------------------------------------------------------------------
-- 6. view ประวัติ: เพิ่มธง "ย้อนหลัง"
-- ---------------------------------------------------------------------------

drop view if exists v_transactions;
create view v_transactions as
select
  s.id,
  s.code                as transaction_id,
  s.work_date,
  s.start_at,
  coalesce(s.finished_at, s.expected_finish_at) as finish_at,
  s.status,
  s.auto_finished,
  s.is_backdated,
  t.id                  as therapist_id,
  t.name                as therapist_name,
  t.nickname            as therapist_nickname,
  t.is_runner           as therapist_is_runner,
  s.service_id,
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
grant select on v_transactions to authenticated;

-- ---------------------------------------------------------------------------
-- 7. ปรับตัวชี้คิวของวันนี้ให้ตรงกับข้อมูลจริงทันทีหลังติดตั้ง
-- ---------------------------------------------------------------------------

select recompute_queue_pointer(app_today());
