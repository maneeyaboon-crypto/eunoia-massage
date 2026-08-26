-- ============================================================================
-- EUNOIA Massage — Migration 005
-- 1) ปิดงานอัตโนมัติเมื่อครบเวลา (มีสวิตช์เปิด/ปิดในหน้าตั้งค่า)
-- 2) หมอวิ่งกดปุ่มเดียว ไม่ต้องกรอกชื่อ (ตั้งชื่อให้เอง: หมอวิ่ง 1, หมอวิ่ง 2 …)
-- 3) แก้ไขรายการที่ลงผิดได้: บริการ ราคา ค่าแรง หมอนวด เวลา ชื่อลูกค้า
-- รันหลัง 001 → 002 → 004   (ปลอดภัยถ้ารันซ้ำ)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. ตั้งค่าของร้าน (แถวเดียว)
-- ---------------------------------------------------------------------------

create table if not exists shop_settings (
  id                     boolean primary key default true check (id),
  auto_finish_enabled    boolean not null default true,
  auto_finish_grace_min  integer not null default 0 check (auto_finish_grace_min between 0 and 60),
  updated_at             timestamptz not null default now(),
  updated_by             uuid references profiles (id)
);

comment on table shop_settings is 'ตั้งค่าระดับร้าน — มีได้แถวเดียวเสมอ';
comment on column shop_settings.auto_finish_enabled is
  'true = ครบเวลาแล้วปิดงานให้อัตโนมัติ (หมอนวดกลับเป็นว่างเอง) · false = ต้องกดปุ่ม "นวดเสร็จ" เอง';
comment on column shop_settings.auto_finish_grace_min is
  'ผ่อนผันกี่นาทีหลังหมดเวลา ค่อยปิดอัตโนมัติ (0 = ปิดทันทีที่ครบเวลา)';

insert into shop_settings (id) values (true) on conflict (id) do nothing;

alter table shop_settings enable row level security;

drop policy if exists shop_settings_read on shop_settings;
create policy shop_settings_read on shop_settings for select using (is_staff());

drop policy if exists shop_settings_owner_write on shop_settings;
create policy shop_settings_owner_write on shop_settings
  for all using (is_owner()) with check (is_owner());

grant select on shop_settings to authenticated;
grant insert, update on shop_settings to authenticated;

-- ---------------------------------------------------------------------------
-- 2. ธงบอกว่ารายการนี้ถูกปิดอัตโนมัติ
-- ---------------------------------------------------------------------------

alter table massage_sessions
  add column if not exists auto_finished boolean not null default false;

comment on column massage_sessions.auto_finished is
  'true = ระบบปิดงานให้เองเมื่อครบเวลา — ยังไม่ได้ระบุช่องทางชำระ ต้องไปเก็บเงินและระบุทีหลัง';

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
      -- ใหม่
      'auto_finished', 'session_edited'
    ));
end $$;

-- ---------------------------------------------------------------------------
-- 3. ปิดงานอัตโนมัติเมื่อครบเวลา
--    ฝั่งหน้าจอเรียกฟังก์ชันนี้เป็นระยะ — เครื่องไหนเปิดอยู่ก็ปิดงานให้ได้
--    ปลอดภัยถ้าเรียกซ้ำ (ปิดเฉพาะรายการที่ยัง active และเลยเวลาแล้วเท่านั้น)
-- ---------------------------------------------------------------------------

create or replace function auto_finish_due()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_cfg   shop_settings;
  v_row   massage_sessions;
  v_count integer := 0;
begin
  if not is_staff() then
    return 0;
  end if;

  select * into v_cfg from shop_settings where id;
  if not coalesce(v_cfg.auto_finish_enabled, false) then
    return 0;
  end if;

  for v_row in
    select * from massage_sessions
    where status = 'active'
      and expected_finish_at + (coalesce(v_cfg.auto_finish_grace_min, 0) || ' minutes')::interval <= now()
    order by expected_finish_at
  loop
    update massage_sessions
       set status        = 'finished',
           finished_at   = expected_finish_at,   -- ใช้เวลาที่ควรเสร็จ ไม่ใช่เวลาที่ระบบเพิ่งมาเจอ
           auto_finished = true
     where id = v_row.id and status = 'active';

    -- หมอนวดที่ลูกค้าขอเจาะจงและตั้งให้ไปต่อท้ายคิว
    if v_row.post_job_queue_action = 'end_of_queue' then
      update daily_queue
         set position = (select coalesce(max(position), 0) + 1
                           from daily_queue where work_date = v_row.work_date)
       where work_date = v_row.work_date and therapist_id = v_row.therapist_id;
    end if;

    insert into queue_events (work_date, event_type, therapist_id, session_id, detail, actor_id)
    values (v_row.work_date, 'auto_finished', v_row.therapist_id, v_row.id,
            'ครบเวลา — ระบบปิดงานให้อัตโนมัติ (ยังไม่ได้เก็บเงิน)', auth.uid());

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

grant execute on function auto_finish_due() to authenticated;

-- รายการที่ปิดแล้วแต่ยังไม่ได้ระบุช่องทางชำระ = ยังไม่ได้เก็บเงิน
create or replace view v_unpaid_sessions as
select s.*, t.name as therapist_name
from massage_sessions s
join therapists t on t.id = s.therapist_id
where s.status = 'finished' and s.payment_method is null;

alter view v_unpaid_sessions set (security_invoker = true);
grant select on v_unpaid_sessions to authenticated;

-- ---------------------------------------------------------------------------
-- 4. เก็บเงินทีหลัง (สำหรับงานที่ปิดอัตโนมัติ)
-- ---------------------------------------------------------------------------

create or replace function settle_session(
  p_session_id     uuid,
  p_payment_method text,
  p_final_price    numeric default null,
  p_actual_pay     numeric default null
)
returns massage_sessions
language plpgsql
security invoker
set search_path = public
as $$
declare v_row massage_sessions;
begin
  if not is_staff() then
    raise exception 'Not authorised';
  end if;

  update massage_sessions
     set payment_method       = p_payment_method,
         final_price          = coalesce(p_final_price, final_price),
         actual_therapist_pay = coalesce(p_actual_pay, actual_therapist_pay),
         finished_by          = coalesce(finished_by, auth.uid())
   where id = p_session_id and status = 'finished'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'ไม่พบรายการ หรือรายการยังไม่ได้ปิดงาน';
  end if;

  insert into payments (session_id, work_date, method, amount, received_by)
  values (v_row.id, v_row.work_date, v_row.payment_method, v_row.final_price, auth.uid());

  insert into queue_events (work_date, event_type, therapist_id, session_id, detail, actor_id)
  values (v_row.work_date, 'finished_massage', v_row.therapist_id, v_row.id,
          'เก็บเงินแล้ว — ฿' || v_row.final_price, auth.uid());

  return v_row;
end;
$$;

grant execute on function settle_session(uuid, text, numeric, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. หมอวิ่งกดปุ่มเดียว — ไม่ต้องกรอกชื่อ
--    ไม่ใส่ชื่อ → ตั้งให้เป็น "หมอวิ่ง 1", "หมอวิ่ง 2" … ไล่ตามลำดับ
-- ---------------------------------------------------------------------------

drop function if exists add_runner(text, text, date);

create or replace function add_runner(
  p_name      text default null,
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
  v_name text := nullif(trim(coalesce(p_name, '')), '');
  v_th   therapists;
  v_pos  integer;
  v_n    integer;
begin
  if not is_staff() then
    raise exception 'Not authorised';
  end if;

  -- ไม่ได้ใส่ชื่อ → หาเลขว่างถัดไป แล้วตั้งเป็น "หมอวิ่ง N"
  if v_name is null then
    v_n := 1;
    loop
      v_name := 'หมอวิ่ง ' || v_n;
      exit when not exists (
        select 1 from daily_queue q
        join therapists t on t.id = q.therapist_id
        where q.work_date = v_date and t.name = v_name
      );
      v_n := v_n + 1;
      if v_n > 99 then
        raise exception 'เรียกหมอวิ่งเกินจำนวนที่รองรับแล้ว';
      end if;
    end loop;
  end if;

  select * into v_th from therapists where name = v_name;

  if v_th.id is null then
    insert into therapists (name, phone, is_active, is_runner, notes)
    values (v_name, p_phone, true, true, 'หมอวิ่ง')
    returning * into v_th;
  elsif not v_th.is_active then
    update therapists set is_active = true where id = v_th.id returning * into v_th;
  end if;

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
-- 6. แก้ไขรายการที่ลงผิด
--    แก้ได้: บริการ · หมอนวด · เวลาเริ่ม · ระยะเวลา · ชื่อลูกค้า ·
--            ราคาขายจริง · ค่าแรง · ช่องทางชำระ · โน้ต
--    ทุกการแก้ถูกบันทึกใน Audit Log อัตโนมัติ (trigger เดิม)
--    ส่งเฉพาะฟิลด์ที่ต้องการแก้ · ฟิลด์ที่ไม่ส่ง (null) จะคงค่าเดิม
-- ---------------------------------------------------------------------------

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
  if v_old.status <> 'active' and not is_owner() then
    raise exception 'รายการที่ปิดงานแล้ว เฉพาะเจ้าของร้านเท่านั้นที่แก้ไขได้';
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

  return v_new;
end;
$$;

grant execute on function update_session(uuid, uuid, uuid, timestamptz, integer, text,
                                         numeric, numeric, numeric, text, text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 7. เก็บชื่อบริการภาษาไทยไว้ใน view ประวัติ (มีอยู่แล้ว) + ธงใหม่
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
