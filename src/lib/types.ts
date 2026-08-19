export type Role = "owner" | "admin";

export type ManualStatus = "available" | "break" | "outside_job" | "off_duty";

/** Status actually shown in the UI. busy/finishing_soon/urgent/expected_finished
 *  are DERIVED from the therapist's active session — never stored. */
export type DerivedStatus =
  | "available"
  | "busy"
  | "finishing_soon"
  | "urgent"
  | "expected_finished"
  | "break"
  | "outside_job"
  | "off_duty";

export type PaymentMethod = "cash" | "qr" | "card" | "other";

export type SessionStatus = "active" | "finished" | "voided";

export type AssignmentType = "queue" | "manual" | "customer_request";

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
  is_active: boolean;
  created_at: string;
}

export interface Therapist {
  id: string;
  name: string;
  nickname: string | null;
  phone: string | null;
  is_active: boolean;
  /** หมอวิ่ง — หมอนวดนอกร้าน เรียกเข้ามาเสริมตอนคนไม่พอ */
  is_runner: boolean;
  pay_override_30: number | null;
  pay_override_60: number | null;
  notes: string | null;
}

export interface Service {
  id: string;
  name_en: string;
  name_th: string | null;
  price: number;
  duration_min: number;
  default_therapist_pay: number;
  is_active: boolean;
  sort_order: number;
}

export interface QueueRow {
  id: string;
  work_date: string;
  therapist_id: string;
  position: number;
  status: ManualStatus;
  checked_in_at: string;
  note: string | null;
  /** regular = ลงคิวเอง · runner = หมอวิ่งที่ถูกเรียกเข้ามา */
  entry_type: "regular" | "runner";
  therapist: Therapist;
}

export interface MassageSession {
  id: string;
  code: string;
  work_date: string;
  therapist_id: string;
  service_id: string | null;
  service_name_en: string;
  service_name_th: string | null;
  base_duration_min: number;
  duration_min: number;
  customer_name: string | null;
  customer_count: number;
  note: string | null;
  start_at: string;
  expected_finish_at: string;
  finished_at: string | null;
  status: SessionStatus;
  original_price: number;
  final_price: number;
  discount: number;
  default_therapist_pay: number;
  actual_therapist_pay: number;
  shop_revenue: number;
  payment_method: PaymentMethod | null;
  assignment_type: AssignmentType;
  assignment_reason: string | null;
  is_customer_request: boolean;
  post_job_queue_action: "rotation" | "end_of_queue";
  /** ลูกค้าที่เข้ามาพร้อมกันใช้รหัสกลุ่มเดียวกัน */
  group_code: string | null;
  group_size: number;
  group_index: number;
  /** งานนี้จ่ายให้หมอวิ่ง */
  is_runner_job: boolean;
  /** ระบบปิดงานให้เองเมื่อครบเวลา — ยังไม่ได้เก็บเงิน */
  auto_finished: boolean;
  void_reason: string | null;
  created_at: string;
}

export interface ShopSettings {
  auto_finish_enabled: boolean;
  auto_finish_grace_min: number;
  sheets_webapp_url: string | null;
  sheets_secret: string | null;
  sheets_auto_on_close: boolean;
  sheets_last_sync_at: string | null;
  sheets_last_status: string | null;
  sheets_last_message: string | null;
  sheets_last_date: string | null;
}

export interface SheetsSyncLog {
  id: string;
  work_date: string;
  status: "ok" | "error";
  message: string | null;
  rows_sent: number;
  trigger_by: "manual" | "close_day" | "test";
  created_at: string;
}

export interface WaitingCustomer {
  id: string;
  work_date: string;
  customer_name: string | null;
  customer_count: number;
  requested_service_id: string | null;
  requested_therapist_id: string | null;
  arrival_at: string;
  note: string | null;
  status: "waiting" | "seated" | "cancelled";
}

export interface QueueEvent {
  id: string;
  work_date: string;
  at: string;
  event_type: string;
  therapist_id: string | null;
  session_id: string | null;
  detail: string | null;
  meta: Record<string, unknown> | null;
}

export interface TherapistDailyStats {
  work_date: string;
  therapist_id: string;
  jobs: number;
  minutes_worked: number;
  sales_generated: number;
  original_value: number;
  discount_given: number;
  therapist_pay: number;
  shop_revenue: number;
  customer_requests: number;
  manual_assignments: number;
  runner_jobs: number;
  busy_skips: number;
  outside_job_count: number;
}

export interface TransactionRow {
  id: string;
  transaction_id: string;
  work_date: string;
  start_at: string;
  finish_at: string;
  status: SessionStatus;
  therapist_id: string;
  therapist_name: string;
  therapist_nickname: string | null;
  therapist_is_runner: boolean;
  group_code: string | null;
  group_size: number;
  group_index: number;
  is_runner_job: boolean;
  auto_finished: boolean;
  service_id: string | null;
  service_name_en: string;
  service_name_th: string | null;
  duration_min: number;
  customer_name: string | null;
  customer_count: number;
  original_price: number;
  final_price: number;
  discount: number;
  default_therapist_pay: number;
  actual_therapist_pay: number;
  shop_revenue: number;
  payment_method: PaymentMethod | null;
  assignment_type: AssignmentType;
  is_customer_request: boolean;
  note: string | null;
  void_reason: string | null;
  voided_at: string | null;
  created_by_email: string | null;
  created_by_name: string | null;
  finished_by_email: string | null;
  created_at: string;
}

export interface AuditLogRow {
  id: number;
  at: string;
  actor_id: string | null;
  actor_email: string | null;
  table_name: string;
  record_id: string | null;
  action: "INSERT" | "UPDATE" | "DELETE";
  field_name: string | null;
  old_value: string | null;
  new_value: string | null;
}

export interface DailyClosing {
  id: string;
  work_date: string;
  closed_at: string;
  total_customers: number;
  total_jobs: number;
  gross_sales: number;
  original_value: number;
  total_discount: number;
  therapist_wages: number;
  net_shop_revenue: number;
  cash_total: number;
  qr_total: number;
  card_total: number;
  other_total: number;
  snapshot: {
    therapists?: Array<Record<string, unknown>>;
    transactions?: Array<Record<string, unknown>>;
  };
  note: string | null;
}
