-- ============================================================================
-- EUNOIA Massage — Migration 003 (OPTIONAL)
-- Wipe the sample/demo data so you can go live with real records.
-- Run this ONCE, before the shop starts using the system for real.
-- It keeps your Services and Therapists — only operational + financial
-- sample rows are removed.
-- ============================================================================

begin;

alter table massage_sessions disable trigger trg_no_delete_sessions;
alter table payments         disable trigger trg_no_delete_payments;

delete from payments;
delete from session_extensions;
delete from waiting_customers;
delete from queue_events;
delete from outside_job_logs;
delete from daily_closings;
delete from massage_sessions;
delete from daily_queue;
delete from queue_state;
delete from audit_logs;

alter table massage_sessions enable trigger trg_no_delete_sessions;
alter table payments         enable trigger trg_no_delete_payments;

alter sequence session_code_seq restart with 1;

-- Optional: also remove the five sample therapists.
-- Uncomment the next line if you have already added your real staff.
-- delete from therapists where name in ('แอนนา','เมย์','หนิง','ฝน','จอย','พี่นก (หมอวิ่ง)','พี่แดง (หมอวิ่ง)');

commit;
