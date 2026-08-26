-- ============================================================================
-- EUNOIA Massage — Migration 006
-- เซฟรายละเอียดของทุกวันลง Google Sheets อัตโนมัติ
--   • day_export()      = รวมข้อมูลของวันนั้นทั้งหมดเป็นก้อนเดียว (3 ชุด)
--   • shop_settings     = เก็บลิงก์ Apps Script + รหัสลับ + สวิตช์ส่งอัตโนมัติ
--   • sheets_sync_log   = ประวัติการส่ง ส่งสำเร็จ/ไม่สำเร็จ ดูย้อนหลังได้
-- รันหลัง 001 → 002 → 004 → 005   (ปลอดภัยถ้ารันซ้ำ)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. ตั้งค่าการเชื่อม Google Sheets (อยู่ในตารางตั้งค่าเดิม)
-- ---------------------------------------------------------------------------

alter table shop_settings
  add column if not exists sheets_webapp_url    text,
  add column if not exists sheets_secret        text,
  add column if not exists sheets_auto_on_close boolean not null default true,
  add column if not exists sheets_last_sync_at  timestamptz,
  add column if not exists sheets_last_status   text,
  add column if not exists sheets_last_message  text,
  add column if not exists sheets_last_date     date;

comment on column shop_settings.sheets_webapp_url is
  'ลิงก์ Web App ของ Google Apps Script (ลงท้ายด้วย /exec) — ว่าง = ยังไม่เชื่อม Google Sheets';
comment on column shop_settings.sheets_secret is
  'รหัสลับที่ต้องตรงกับใน Apps Script — กันคนอื่นยิงข้อมูลมั่วเข้าชีตของร้าน';
comment on column shop_settings.sheets_auto_on_close is
  'true = พอกดปิดวัน ระบบส่งข้อมูลของวันนั้นเข้า Google Sheets ให้เอง';

-- ---------------------------------------------------------------------------
-- 2. ประวัติการส่งข้อมูลเข้าชีต
-- ---------------------------------------------------------------------------

create table if not exists sheets_sync_log (
  id          uuid primary key default gen_random_uuid(),
  work_date   date not null,
  status      text not null check (status in ('ok', 'error')),
  message     text,
  rows_sent   integer not null default 0,
  trigger_by  text not null default 'manual' check (trigger_by in ('manual', 'close_day', 'test')),
  actor_id    uuid references profiles (id),
  created_at  timestamptz not null default now()
);

create index if not exists sheets_sync_log_date_idx on sheets_sync_log (work_date desc, created_at desc);

alter table sheets_sync_log enable row level security;

drop policy if exists sheets_log_read on sheets_sync_log;
create policy sheets_log_read on sheets_sync_log for select using (is_staff());

drop policy if exists sheets_log_write on sheets_sync_log;
create policy sheets_log_write on sheets_sync_log for insert with check (is_staff());

grant select, insert on sheets_sync_log to authenticated;

-- บันทึกการส่งเข้าชีตก็เป็นข้อมูลย้อนหลัง — ห้ามลบทิ้งเหมือนกัน
drop trigger if exists no_delete_sheets_log on sheets_sync_log;
create trigger no_delete_sheets_log
  before delete on sheets_sync_log
  for each row execute function block_financial_delete();

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
      'group_received', 'runner_called', 'runner_shortage',
      'auto_finished', 'session_edited',
      -- ใหม่
      'sheets_synced'
    ));
end $$;

-- ---------------------------------------------------------------------------
-- 4. day_export() — รวมรายละเอียดของวันนั้นทั้งหมดเป็น JSON ก้อนเดียว
--    เวลาแปลงเป็นเวลาไทยให้เรียบร้อยแล้ว ชีตจะได้ไม่ต้องคำนวณอะไรอีก
-- ---------------------------------------------------------------------------

create or replace function day_export(p_work_date date default app_today())
returns jsonb
language plpgsql
security invoker
stable
set search_path = public
as $$
declare
  v_fin        record;
  v_close      daily_closings;
  v_tx         jsonb;
  v_therapists jsonb;
  v_summary    jsonb;
  v_voided     integer;
  v_runner     integer;
  v_on_duty    integer;
begin
  if not is_staff() then
    raise exception 'ไม่มีสิทธิ์ดึงข้อมูลของวัน';
  end if;

  select * into v_fin   from v_daily_financials where work_date = p_work_date;
  select * into v_close from daily_closings     where work_date = p_work_date;

  select
    count(*) filter (where status = 'voided'),
    count(*) filter (where is_runner_job and status <> 'voided')
  into v_voided, v_runner
  from massage_sessions where work_date = p_work_date;

  select count(*) into v_on_duty from daily_queue where work_date = p_work_date;

  -- ชุดที่ 1: ทุกรายการนวดของวันนั้น (รวมรายการที่ยกเลิกไว้ด้วย เพื่อให้ตรวจสอบย้อนหลังได้)
  select coalesce(jsonb_agg(x order by x ->> 'start_time', x ->> 'transaction_id'), '[]'::jsonb)
  into v_tx
  from (
    select jsonb_build_object(
      'transaction_id',  v.transaction_id,
      'work_date',       to_char(v.work_date, 'YYYY-MM-DD'),
      'start_time',      to_char(v.start_at at time zone 'Asia/Bangkok', 'HH24:MI'),
      'finish_time',     to_char(v.finish_at at time zone 'Asia/Bangkok', 'HH24:MI'),
      'status',          case v.status
                           when 'active'   then 'กำลังนวด'
                           when 'finished' then 'เสร็จแล้ว'
                           when 'voided'   then 'ยกเลิก'
                           else v.status end,
      'therapist_name',  v.therapist_name,
      'therapist_type',  case when v.is_runner_job then 'หมอวิ่ง' else 'หมอประจำ' end,
      'service_name',    coalesce(v.service_name_th, v.service_name_en),
      'duration_min',    v.duration_min,
      'customer_name',   coalesce(v.customer_name, ''),
      'customer_count',  v.customer_count,
      'group_code',      coalesce(v.group_code, ''),
      'original_price',  v.original_price,
      'final_price',     v.final_price,
      'discount',        v.discount,
      'default_pay',     v.default_therapist_pay,
      'actual_pay',      v.actual_therapist_pay,
      'shop_revenue',    v.shop_revenue,
      'payment_method',  case v.payment_method
                           when 'cash'  then 'เงินสด'
                           when 'qr'    then 'QR / โอน'
                           when 'card'  then 'บัตร'
                           when 'other' then 'อื่น ๆ'
                           else 'ยังไม่เก็บเงิน' end,
      'assignment_type', case v.assignment_type
                           when 'queue'            then 'ตามคิว'
                           when 'manual'           then 'เลือกเอง'
                           when 'customer_request' then 'ลูกค้าขอ'
                           else coalesce(v.assignment_type, '') end,
      'customer_request', case when v.is_customer_request then 'ใช่' else '' end,
      'auto_finished',   case when v.auto_finished then 'ปิดอัตโนมัติ' else '' end,
      'note',            coalesce(v.note, ''),
      'void_reason',     coalesce(v.void_reason, '')
    ) as x
    from v_transactions v
    where v.work_date = p_work_date
  ) t;

  -- ชุดที่ 2: สรุปรายหมอนวด
  select coalesce(jsonb_agg(x order by (x ->> 'jobs')::int desc, x ->> 'therapist_name'), '[]'::jsonb)
  into v_therapists
  from (
    select jsonb_build_object(
      'work_date',        to_char(p_work_date, 'YYYY-MM-DD'),
      'therapist_name',   t.name,
      'therapist_type',   case when t.is_runner then 'หมอวิ่ง' else 'หมอประจำ' end,
      'queue_position',   q.position,
      'jobs',             st.jobs,
      'minutes_worked',   st.minutes_worked,
      'sales_generated',  st.sales_generated,
      'discount_given',   st.discount_given,
      'therapist_pay',    st.therapist_pay,
      'shop_revenue',     st.shop_revenue,
      'customer_requests', st.customer_requests,
      'runner_jobs',      st.runner_jobs,
      'busy_skips',       st.busy_skips,
      'outside_jobs',     st.outside_job_count
    ) as x
    from v_therapist_daily_stats st
    join therapists t on t.id = st.therapist_id
    left join daily_queue q on q.therapist_id = st.therapist_id and q.work_date = p_work_date
    where st.work_date = p_work_date
  ) t;

  -- ชุดที่ 3: สรุปของทั้งวัน (บรรทัดเดียว)
  v_summary := jsonb_build_object(
    'work_date',        to_char(p_work_date, 'YYYY-MM-DD'),
    'closed',           case when v_close.work_date is not null then 'ปิดวันแล้ว' else 'ยังไม่ปิดวัน' end,
    'closed_at',        case when v_close.closed_at is not null
                          then to_char(v_close.closed_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI')
                          else '' end,
    'therapists_on_duty', coalesce(v_on_duty, 0),
    'total_jobs',       coalesce(v_fin.total_jobs, 0),
    'total_customers',  coalesce(v_fin.total_customers, 0),
    'runner_jobs',      coalesce(v_runner, 0),
    'voided_jobs',      coalesce(v_voided, 0),
    'original_value',   coalesce(v_fin.original_value, 0),
    'gross_sales',      coalesce(v_fin.gross_sales, 0),
    'total_discount',   coalesce(v_fin.total_discount, 0),
    'therapist_wages',  coalesce(v_fin.therapist_wages, 0),
    'net_shop_revenue', coalesce(v_fin.net_shop_revenue, 0),
    'cash_total',       coalesce(v_fin.cash_total, 0),
    'qr_total',         coalesce(v_fin.qr_total, 0),
    'card_total',       coalesce(v_fin.card_total, 0),
    'other_total',      coalesce(v_fin.other_total, 0),
    'unpaid_total',     coalesce(v_fin.unpaid_total, 0)
  );

  return jsonb_build_object(
    'shop',         'EUNOIA Massage',
    'work_date',    to_char(p_work_date, 'YYYY-MM-DD'),
    'generated_at', to_char(now() at time zone 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI:SS'),
    'summary',      v_summary,
    'transactions', v_tx,
    'therapists',   v_therapists
  );
end;
$$;

comment on function day_export(date) is
  'รวมรายละเอียดของวันนั้นทั้งหมด (รายการนวด / สรุปรายหมอนวด / สรุปทั้งวัน) เป็น JSON ก้อนเดียว สำหรับส่งเข้า Google Sheets';

grant execute on function day_export(date) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. log_sheets_sync() — บันทึกผลการส่งเข้าชีต
-- ---------------------------------------------------------------------------

create or replace function log_sheets_sync(
  p_work_date  date,
  p_status     text,
  p_message    text default null,
  p_rows       integer default 0,
  p_trigger_by text default 'manual'
)
returns sheets_sync_log
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row sheets_sync_log;
begin
  if not is_staff() then
    raise exception 'ไม่มีสิทธิ์บันทึกผลการส่งข้อมูล';
  end if;

  insert into sheets_sync_log (work_date, status, message, rows_sent, trigger_by, actor_id)
  values (p_work_date, p_status, p_message, coalesce(p_rows, 0),
          coalesce(p_trigger_by, 'manual'), auth.uid())
  returning * into v_row;

  update shop_settings
     set sheets_last_sync_at = now(),
         sheets_last_status  = p_status,
         sheets_last_message = p_message,
         sheets_last_date    = p_work_date
   where id = true;

  if p_status = 'ok' then
    insert into queue_events (work_date, event_type, detail, actor_id)
    values (p_work_date, 'sheets_synced',
            'ส่งเข้า Google Sheets แล้ว ' || coalesce(p_rows, 0) || ' รายการ', auth.uid());
  end if;

  return v_row;
end;
$$;

grant execute on function log_sheets_sync(date, text, text, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. วันไหนที่ยังไม่เคยส่งเข้าชีตสำเร็จ (ไว้ตามเก็บย้อนหลัง)
-- ---------------------------------------------------------------------------

drop view if exists v_sheets_pending_days;
create view v_sheets_pending_days as
select
  d.work_date,
  d.total_jobs,
  d.gross_sales,
  (select max(l.created_at) from sheets_sync_log l
    where l.work_date = d.work_date and l.status = 'ok') as last_ok_at
from v_daily_financials d
where not exists (
  select 1 from sheets_sync_log l
   where l.work_date = d.work_date and l.status = 'ok'
);

alter view v_sheets_pending_days set (security_invoker = true);
grant select on v_sheets_pending_days to authenticated;

-- ---------------------------------------------------------------------------
-- 7. เปิด Realtime ให้ตารางที่เหลือ (อัปเดตข้ามเครื่องทันที)
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['session_extensions', 'daily_closings', 'shop_settings']
  loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
exception when others then
  raise notice 'ข้าม Realtime: %', sqlerrm;
end $$;
