-- ============================================================================
-- EUNOIA Massage — Migration 002: Service master + sample data
-- Safe to re-run: services/therapists are upserted by name, sample sessions
-- are only created if today has no sessions yet.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- SERVICE MASTER
-- Default therapist pay rule: 30 min = ฿100, 60 min standard = ฿150,
-- ฿500/hour premium services = ฿180.  All editable in Settings → Services.
-- ---------------------------------------------------------------------------

create unique index if not exists services_name_en_uniq on services (name_en);

insert into services (name_en, name_th, price, duration_min, default_therapist_pay, sort_order, is_active)
values
  ('Head Massage',            'นวดหัว',              250, 30, 100,  10, true),
  ('Foot Massage',            'นวดเท้า',             300, 60, 150,  20, true),
  ('Thai Massage',            'นวดไทย',              300, 60, 150,  30, true),
  ('Oil Massage',             'นวดออย',              400, 60, 150,  40, true),
  ('Back Neck Shoulder',      'คอ บ่า ไหล่',          500, 60, 180,  50, true),
  ('Aloe Vera Massage',       'นวดอโลเวร่า',          500, 60, 180,  60, true),
  ('Aroma Massage',           'นวดอโรม่า',            500, 60, 180,  70, true),
  ('Coconut Oil Massage',     'นวดน้ำมันมะพร้าว',      500, 60, 180,  80, true),
  ('Hot Coconut Oil Massage', 'นวดน้ำมันมะพร้าวร้อน',  600, 60, 180,  90, true),
  ('Foot Scrub',              'ขัดส้นเท้า',           500, 30, 100, 100, true),
  ('Facial and Head Massage', 'นวดหน้าและหัว',        800, 60, 180, 110, true),
  -- Price/duration not fixed yet — Owner sets it in Settings, then enables it.
  ('Facial Massage',          'นวดหน้า',               0, 30, 100, 105, false)
on conflict (name_en) do nothing;

-- ---------------------------------------------------------------------------
-- SAMPLE THERAPISTS
-- ---------------------------------------------------------------------------

create unique index if not exists therapists_name_uniq on therapists (name);

-- ชื่อตัวอย่าง — เปลี่ยนเป็นชื่อพนักงานจริงได้ที่หน้า ตั้งค่า → หมอนวด
insert into therapists (name, nickname, phone, is_active, notes)
values
  ('แอนนา', null, '081-000-0001', true, 'ลูกค้าประจำเยอะ ถนัดน้ำมัน'),
  ('เมย์',  null, '081-000-0002', true, null),
  ('หนิง',  null, '081-000-0003', true, 'ถนัดนวดไทย กดจุด'),
  ('ฝน',   null, '081-000-0004', true, null),
  ('จอย',  null, '081-000-0005', true, 'รับงานนอกร้านบ่อย')
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- SAMPLE WORKING DAY (only if today is still empty)
-- ---------------------------------------------------------------------------

do $$
declare
  v_date  date := app_today();
  v_anna  uuid; v_may uuid; v_ning uuid; v_fon uuid; v_joy uuid;
  v_aroma uuid; v_thai uuid; v_foot uuid; v_bns uuid; v_head uuid;
  v_sid   uuid;
begin
  if exists (select 1 from daily_queue where work_date = v_date) then
    raise notice 'Sample data skipped — today already has a queue.';
    return;
  end if;

  select id into v_anna from therapists where name = 'แอนนา';
  select id into v_may  from therapists where name = 'เมย์';
  select id into v_ning from therapists where name = 'หนิง';
  select id into v_fon  from therapists where name = 'ฝน';
  select id into v_joy  from therapists where name = 'จอย';

  select id into v_aroma from services where name_en = 'Aroma Massage';
  select id into v_thai  from services where name_en = 'Thai Massage';
  select id into v_foot  from services where name_en = 'Foot Massage';
  select id into v_bns   from services where name_en = 'Back Neck Shoulder';
  select id into v_head  from services where name_en = 'Head Massage';

  -- Check-in order = queue order
  insert into daily_queue (work_date, therapist_id, position, status, checked_in_at) values
    (v_date, v_anna, 1, 'available',   now() - interval '5 hours'),
    (v_date, v_may,  2, 'available',   now() - interval '4 hours 50 minutes'),
    (v_date, v_ning, 3, 'available',   now() - interval '4 hours 40 minutes'),
    (v_date, v_fon,  4, 'break',       now() - interval '4 hours 30 minutes'),
    (v_date, v_joy,  5, 'outside_job', now() - interval '4 hours 20 minutes');

  insert into queue_events (work_date, event_type, therapist_id, detail, at)
  select v_date, 'check_in', therapist_id, 'ลงคิว #' || position, checked_in_at
  from daily_queue where work_date = v_date;

  -- Joy is out on an outside job
  insert into outside_job_logs (work_date, therapist_id, left_at, note)
  values (v_date, v_joy, now() - interval '1 hour 10 minutes', 'ไปร้านพันธมิตรใกล้ ๆ');
  insert into queue_events (work_date, event_type, therapist_id, detail, at)
  values (v_date, 'outside_job_start', v_joy, 'ออกไปรับงานร้านอื่น', now() - interval '1 hour 10 minutes');

  -- ---- Finished jobs earlier today ----------------------------------------
  insert into massage_sessions (
    work_date, therapist_id, service_id, service_name_en, service_name_th,
    base_duration_min, duration_min, customer_name, customer_count,
    start_at, expected_finish_at, finished_at, status,
    original_price, final_price, default_therapist_pay, actual_therapist_pay,
    payment_method, assignment_type
  ) values
    (v_date, v_anna, v_thai, 'Thai Massage', 'นวดไทย', 60, 60, 'คุณสมชาย', 1,
     now() - interval '4 hours 30 minutes', now() - interval '3 hours 30 minutes',
     now() - interval '3 hours 25 minutes', 'finished',
     300, 300, 150, 150, 'cash', 'queue'),
    (v_date, v_may, v_bns, 'Back Neck Shoulder', 'คอ บ่า ไหล่', 60, 60, 'ลูกค้าเดินเข้า', 2,
     now() - interval '4 hours 20 minutes', now() - interval '3 hours 20 minutes',
     now() - interval '3 hours 15 minutes', 'finished',
     1000, 900, 360, 360, 'qr', 'queue'),
    (v_date, v_ning, v_foot, 'Foot Massage', 'นวดเท้า', 60, 60, null, 1,
     now() - interval '4 hours', now() - interval '3 hours',
     now() - interval '2 hours 55 minutes', 'finished',
     300, 280, 150, 150, 'cash', 'queue'),
    (v_date, v_anna, v_head, 'Head Massage', 'นวดหัว', 30, 30, 'คุณมาลี', 1,
     now() - interval '3 hours', now() - interval '2 hours 30 minutes',
     now() - interval '2 hours 28 minutes', 'finished',
     250, 250, 100, 100, 'card', 'customer_request'),
    (v_date, v_may, v_aroma, 'Aroma Massage', 'นวดอโรม่า', 60, 60, 'คุณจอห์น', 1,
     now() - interval '2 hours 40 minutes', now() - interval '1 hour 40 minutes',
     now() - interval '1 hour 35 minutes', 'finished',
     500, 450, 180, 150, 'cash', 'queue');

  update massage_sessions set is_customer_request = true
   where work_date = v_date and assignment_type = 'customer_request';

  insert into payments (session_id, work_date, method, amount)
  select id, work_date, payment_method, final_price
  from massage_sessions
  where work_date = v_date and status = 'finished' and payment_method is not null;

  -- ---- Two massages running right now -------------------------------------
  -- Anna: started 35 min ago, 60 min service  -> ~25 min remaining (Busy)
  insert into massage_sessions (
    work_date, therapist_id, service_id, service_name_en, service_name_th,
    base_duration_min, duration_min, customer_name, customer_count, note,
    start_at, expected_finish_at, status,
    original_price, final_price, default_therapist_pay, actual_therapist_pay,
    assignment_type
  ) values (
    v_date, v_anna, v_aroma, 'Aroma Massage', 'นวดอโรม่า', 60, 60, 'คุณปราณี', 1,
    'ลูกค้าขอนวดหนัก',
    date_trunc('minute', now()) - interval '35 minutes',
    date_trunc('minute', now()) + interval '25 minutes', 'active',
    500, 500, 180, 180, 'queue'
  ) returning id into v_sid;
  insert into queue_events (work_date, event_type, therapist_id, session_id, detail, at)
  values (v_date, 'received_customer', v_anna, v_sid, 'Aroma Massage — 60 min',
          date_trunc('minute', now()) - interval '35 minutes');

  -- Ning: started 48 min ago, 60 min service -> ~12 min remaining (Finishing Soon)
  insert into massage_sessions (
    work_date, therapist_id, service_id, service_name_en, service_name_th,
    base_duration_min, duration_min, customer_name, customer_count,
    start_at, expected_finish_at, status,
    original_price, final_price, default_therapist_pay, actual_therapist_pay,
    assignment_type
  ) values (
    v_date, v_ning, v_thai, 'Thai Massage', 'นวดไทย', 60, 60, 'คุณวิภา', 1,
    date_trunc('minute', now()) - interval '48 minutes',
    date_trunc('minute', now()) + interval '12 minutes', 'active',
    300, 300, 150, 150, 'queue'
  ) returning id into v_sid;
  insert into queue_events (work_date, event_type, therapist_id, session_id, detail, at)
  values (v_date, 'received_customer', v_ning, v_sid, 'Thai Massage — 60 min',
          date_trunc('minute', now()) - interval '48 minutes');

  -- Rotation pointer: Ning received the last customer
  insert into queue_state (work_date, last_assigned_therapist_id)
  values (v_date, v_ning)
  on conflict (work_date) do update set last_assigned_therapist_id = excluded.last_assigned_therapist_id;

  -- A skip that happened along the way
  insert into queue_events (work_date, event_type, therapist_id, detail, at)
  values (v_date, 'skipped_busy', v_anna, 'ข้ามเพราะกำลังนวด', date_trunc('minute', now()) - interval '48 minutes');

  -- ---- Someone waiting ----------------------------------------------------
  insert into waiting_customers (work_date, customer_name, customer_count,
                                 requested_service_id, requested_therapist_id, arrival_at, note)
  values (v_date, 'คุณอรุณี', 1, v_aroma, v_anna,
          now() - interval '8 minutes', 'ขอรอแอนนาโดยเฉพาะ');

  raise notice 'Sample data for % created.', v_date;
end $$;
