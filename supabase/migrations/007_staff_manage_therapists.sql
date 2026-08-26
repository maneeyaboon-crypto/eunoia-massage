-- ============================================================================
-- EUNOIA Massage — Migration 007
-- ให้ "พนักงานหน้าร้าน" เพิ่ม/แก้ชื่อหมอนวดได้ด้วย
--   เดิม: ตาราง therapists แก้ได้เฉพาะเจ้าของร้าน
--   ใหม่: พนักงานหน้าร้านเพิ่มชื่อและแก้ข้อมูลหมอนวดได้ (เผื่อมีหมอใหม่เข้าทำงานกะทันหัน)
--         แต่ "ลบ" ยังเป็นสิทธิ์ของเจ้าของร้านเท่านั้น
--
--   ราคา ค่าแรง การเงิน ปิดวัน ยกเลิกรายการ ยังเป็นของเจ้าของร้านเหมือนเดิม
-- รันหลัง 001 → 002 → 004 → 005 → 006   (ปลอดภัยถ้ารันซ้ำ)
-- ============================================================================

-- เอานโยบายเดิม (เจ้าของร้านเท่านั้น) ของตาราง therapists ออก
drop policy if exists therapists_owner_write on therapists;

-- เพิ่มหมอนวดใหม่: พนักงานหน้าร้านทำได้
drop policy if exists therapists_staff_insert on therapists;
create policy therapists_staff_insert on therapists
  for insert with check (is_staff());

-- แก้ไขข้อมูลหมอนวด (ชื่อเล่น เบอร์โทร เปิด/ปิดใช้งาน หมายเหตุ): พนักงานหน้าร้านทำได้
drop policy if exists therapists_staff_update on therapists;
create policy therapists_staff_update on therapists
  for update using (is_staff()) with check (is_staff());

-- ลบหมอนวด: เจ้าของร้านเท่านั้น
-- (และถ้าหมอนวดคนนั้นเคยมีรายการขายแล้ว ฐานข้อมูลจะไม่ยอมให้ลบอยู่ดี —
--  ให้ใช้ "ปิดใช้งาน" แทน ประวัติและยอดเดิมจะยังอยู่ครบ)
drop policy if exists therapists_owner_delete on therapists;
create policy therapists_owner_delete on therapists
  for delete using (is_owner());

comment on table therapists is
  'ข้อมูลหมอนวด — พนักงานหน้าร้านเพิ่ม/แก้ได้ · ลบได้เฉพาะเจ้าของร้าน · '
  'ห้ามลบคนที่เคยมีรายการขาย ให้ใช้ is_active = false แทน';
