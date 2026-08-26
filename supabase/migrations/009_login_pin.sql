-- ============================================================================
-- EUNOIA Massage — Migration 009
-- เข้าระบบด้วย PIN 6 หลัก (ไม่ต้องจำอีเมล + รหัสผ่าน)
--
--   • PIN หนึ่งอันผูกกับบัญชีหนึ่งบัญชี เช่น
--       "หน้าร้าน"      → บัญชีพนักงาน (admin)  เห็นคิว/รับลูกค้า แต่ไม่เห็นการเงิน
--       "เจ้าของร้าน"   → บัญชีเจ้าของร้าน (owner) เห็นทุกอย่าง
--     ตั้งได้หลายอัน — ถ้าอยากรู้ว่าใครเป็นคนกรอก ก็ตั้ง PIN แยกรายคนได้
--   • เก็บเฉพาะ "ลายนิ้วมือ" ของ PIN (bcrypt) ไม่ได้เก็บตัวเลขจริง
--     ต่อให้ฐานข้อมูลหลุด ก็อ่านย้อนกลับเป็นตัวเลขไม่ได้
--   • กรอกผิด 5 ครั้งใน 15 นาที = ล็อกชั่วคราว กันคนสุ่มเลข
--   • การตรวจ PIN ทำที่ฝั่งเซิร์ฟเวอร์เท่านั้น (/api/pin-login)
--     รหัสผ่านจริงของบัญชีไม่เคยถูกส่งมาที่หน้าเว็บ
--
-- รันหลัง 001 → 002 → 004 → 005 → 006 → 007 → 008   (ปลอดภัยถ้ารันซ้ำ)
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- 1. ตาราง PIN
-- ---------------------------------------------------------------------------
create table if not exists login_pins (
  id          uuid primary key default gen_random_uuid(),
  label       text not null unique,
  profile_id  uuid not null references profiles (id) on delete cascade,
  pin_hash    text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table login_pins is
  'PIN สำหรับเข้าระบบ — เก็บเฉพาะ bcrypt hash · หนึ่ง PIN ผูกกับหนึ่งบัญชี';
comment on column login_pins.label is 'ชื่อเรียก เช่น หน้าร้าน / เจ้าของร้าน / ชื่อพนักงาน';

alter table login_pins enable row level security;

-- อ่าน/แก้ได้เฉพาะเจ้าของร้าน (service role ข้าม RLS อยู่แล้ว)
drop policy if exists login_pins_owner_all on login_pins;
create policy login_pins_owner_all on login_pins
  for all using (is_owner()) with check (is_owner());

-- ---------------------------------------------------------------------------
-- 2. บันทึกความพยายามกรอก PIN — ใช้กันการสุ่มเลข
--    ไม่มี policy ใด ๆ = ฝั่งเบราว์เซอร์แตะไม่ได้เลย มีแต่เซิร์ฟเวอร์ที่เขียนได้
-- ---------------------------------------------------------------------------
create table if not exists pin_attempts (
  id      bigserial primary key,
  at      timestamptz not null default now(),
  ok      boolean not null,
  client  text
);

alter table pin_attempts enable row level security;

create index if not exists pin_attempts_at_idx on pin_attempts (at desc);
create index if not exists pin_attempts_client_idx on pin_attempts (client, at desc);

comment on table pin_attempts is
  'ประวัติการกรอก PIN (ถูก/ผิด) ใช้ล็อกชั่วคราวเมื่อกรอกผิดถี่เกินไป';

-- ---------------------------------------------------------------------------
-- 3. ตรวจ PIN — เรียกจากเซิร์ฟเวอร์ด้วย service role เท่านั้น
--    คืนอีเมลของบัญชีที่ตรงกับ PIN · ถ้าไม่ตรงคืนศูนย์แถว
-- ---------------------------------------------------------------------------
create or replace function verify_login_pin(p_pin text, p_client text default null)
returns table (email text, role text, label text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_fail  integer;
  v_email text;
  v_role  text;
  v_label text;
begin
  -- ล็อกชั่วคราวถ้ากรอกผิดถี่เกินไป (นับเฉพาะเครื่องนั้น ถ้าระบุมา)
  select count(*) into v_fail
    from pin_attempts a
   where not a.ok
     and a.at > now() - interval '15 minutes'
     and (p_client is null or a.client = p_client);

  if v_fail >= 5 then
    raise exception 'ใส่ PIN ผิดหลายครั้งเกินไป — รอ 15 นาทีแล้วลองใหม่ค่ะ'
      using errcode = 'P0001';
  end if;

  if p_pin is null or p_pin !~ '^[0-9]{4,10}$' then
    insert into pin_attempts (ok, client) values (false, p_client);
    return;
  end if;

  select p.email, p.role, lp.label
    into v_email, v_role, v_label
    from login_pins lp
    join profiles p on p.id = lp.profile_id
   where lp.is_active
     and p.is_active
     and lp.pin_hash = crypt(p_pin, lp.pin_hash)
   limit 1;

  insert into pin_attempts (ok, client) values (v_email is not null, p_client);

  if v_email is null then
    return;
  end if;

  return query select v_email, v_role, v_label;
end;
$$;

revoke all on function verify_login_pin(text, text) from public, anon, authenticated;

comment on function verify_login_pin(text, text) is
  'ตรวจ PIN แล้วคืนอีเมลของบัญชีที่ผูกไว้ — เรียกได้เฉพาะฝั่งเซิร์ฟเวอร์ (service role)';

-- ---------------------------------------------------------------------------
-- 4. ตั้ง / เปลี่ยน PIN — เจ้าของร้านเท่านั้น
-- ---------------------------------------------------------------------------
create or replace function set_login_pin(p_label text, p_profile_id uuid, p_pin text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid;
begin
  if not is_owner() then
    raise exception 'เฉพาะบัญชีเจ้าของร้านเท่านั้นที่ตั้ง PIN ได้';
  end if;

  if p_pin !~ '^[0-9]{6}$' then
    raise exception 'PIN ต้องเป็นตัวเลข 6 หลัก';
  end if;

  if p_pin in ('000000', '111111', '123456', '654321') then
    raise exception 'PIN นี้เดาง่ายเกินไป กรุณาตั้งเลขอื่น';
  end if;

  if not exists (select 1 from profiles where id = p_profile_id and is_active) then
    raise exception 'ไม่พบบัญชีผู้ใช้ที่เลือก';
  end if;

  -- PIN ห้ามซ้ำกัน ไม่งั้นจะไม่รู้ว่าเข้าเป็นใคร
  if exists (
    select 1 from login_pins
     where label <> p_label
       and pin_hash = crypt(p_pin, pin_hash)
  ) then
    raise exception 'PIN นี้ถูกใช้ไปแล้ว กรุณาตั้งเลขอื่น';
  end if;

  insert into login_pins (label, profile_id, pin_hash)
  values (p_label, p_profile_id, crypt(p_pin, gen_salt('bf')))
  on conflict (label) do update
    set pin_hash   = excluded.pin_hash,
        profile_id = excluded.profile_id,
        is_active  = true,
        updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

comment on function set_login_pin(text, uuid, text) is
  'ตั้งหรือเปลี่ยน PIN — เจ้าของร้านเท่านั้น · เก็บเฉพาะ bcrypt hash';

-- ---------------------------------------------------------------------------
-- 5. รายการ PIN ที่ตั้งไว้ (ไม่คืนค่า hash) — ไว้แสดงในหน้าตั้งค่า
-- ---------------------------------------------------------------------------
create or replace view v_login_pins
with (security_invoker = true) as
select lp.id,
       lp.label,
       lp.profile_id,
       p.email,
       p.full_name,
       p.role,
       lp.is_active,
       lp.updated_at
  from login_pins lp
  join profiles p on p.id = lp.profile_id;

comment on view v_login_pins is 'รายการ PIN ที่ตั้งไว้ — ไม่แสดงตัวเลข PIN และไม่แสดง hash';

-- ---------------------------------------------------------------------------
-- 6. ล้างประวัติการกรอก PIN ที่เก่ากว่า 30 วัน (เรียกเองเมื่อไหร่ก็ได้)
-- ---------------------------------------------------------------------------
create or replace function prune_pin_attempts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_n integer;
begin
  delete from pin_attempts where at < now() - interval '30 days';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- วิธีตั้ง PIN อันแรก (ตอนที่ยังเข้าแอปไม่ได้)
-- เปิด Supabase → SQL Editor แล้ววางคำสั่งข้างล่างนี้ เปลี่ยนเลข 6 หลักเป็นของตัวเอง
--
--   insert into login_pins (label, profile_id, pin_hash)
--   select 'หน้าร้าน', id, crypt('482913', gen_salt('bf'))
--     from profiles where email = 'อีเมลของบัญชีพนักงาน'
--   on conflict (label) do update set pin_hash = excluded.pin_hash, updated_at = now();
--
--   insert into login_pins (label, profile_id, pin_hash)
--   select 'เจ้าของร้าน', id, crypt('750264', gen_salt('bf'))
--     from profiles where email = 'อีเมลของบัญชีเจ้าของร้าน'
--   on conflict (label) do update set pin_hash = excluded.pin_hash, updated_at = now();
--
-- หลังจากนั้นเปลี่ยน PIN ได้เองที่ ตั้งค่า → PIN เข้าระบบ
-- ---------------------------------------------------------------------------
