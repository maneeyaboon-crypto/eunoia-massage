import type { DerivedStatus, ManualStatus, PaymentMethod } from "./types";

interface StatusMeta {
  dot: string;
  labelEn: string;
  labelTh: string;
  /** Tailwind classes for a pill / badge. */
  badge: string;
  /** Tailwind classes for a coloured left border on cards. */
  border: string;
  /** Solid colour for bars / rings. */
  solid: string;
}

export const STATUS: Record<DerivedStatus, StatusMeta> = {
  available: {
    dot: "🟢",
    labelEn: "Available",
    labelTh: "ว่าง",
    badge: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
    border: "border-l-emerald-500",
    solid: "bg-emerald-500",
  },
  busy: {
    dot: "🔴",
    labelEn: "Busy",
    labelTh: "กำลังนวด",
    badge: "bg-red-50 text-red-700 ring-1 ring-red-200",
    border: "border-l-red-500",
    solid: "bg-red-500",
  },
  finishing_soon: {
    dot: "🟠",
    labelEn: "Finishing Soon",
    labelTh: "ใกล้เสร็จ",
    badge: "bg-orange-50 text-orange-700 ring-1 ring-orange-200",
    border: "border-l-orange-500",
    solid: "bg-orange-500",
  },
  urgent: {
    dot: "🔴",
    labelEn: "Almost Done",
    labelTh: "ใกล้เสร็จมาก",
    badge: "bg-rose-100 text-rose-800 ring-1 ring-rose-300",
    border: "border-l-rose-600",
    solid: "bg-rose-600",
  },
  expected_finished: {
    dot: "🟢",
    labelEn: "Expected Finished",
    labelTh: "หมดเวลา — รอกด Finish",
    badge: "bg-green-100 text-green-800 ring-1 ring-green-300 animate-pulse",
    border: "border-l-green-600",
    solid: "bg-green-600",
  },
  break: {
    dot: "⚪",
    labelEn: "Break",
    labelTh: "พัก",
    badge: "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
    border: "border-l-slate-400",
    solid: "bg-slate-400",
  },
  outside_job: {
    dot: "🟣",
    labelEn: "Outside Job",
    labelTh: "งานร้านอื่น",
    badge: "bg-purple-50 text-purple-700 ring-1 ring-purple-200",
    border: "border-l-purple-500",
    solid: "bg-purple-500",
  },
  off_duty: {
    dot: "⚫",
    labelEn: "Off Duty",
    labelTh: "เลิกงาน",
    badge: "bg-slate-200 text-slate-700 ring-1 ring-slate-300",
    border: "border-l-slate-600",
    solid: "bg-slate-600",
  },
};

export const MANUAL_STATUS_OPTIONS: Array<{ value: ManualStatus; label: string }> = [
  { value: "available", label: "🟢 ว่าง" },
  { value: "break", label: "⚪ พัก" },
  { value: "outside_job", label: "🟣 งานร้านอื่น" },
  { value: "off_duty", label: "⚫ เลิกงาน" },
];

export const PAYMENT_METHODS: Array<{ value: PaymentMethod; label: string; icon: string }> = [
  { value: "cash", label: "เงินสด", icon: "💵" },
  { value: "qr", label: "QR / โอน", icon: "📱" },
  { value: "card", label: "บัตร", icon: "💳" },
  { value: "other", label: "อื่น ๆ", icon: "•" },
];

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  cash: "เงินสด",
  qr: "QR / โอน",
  card: "บัตร",
  other: "อื่น ๆ",
};

export const OVERRIDE_REASONS = [
  "ลูกค้าขอหมอนวดคนนี้",
  "หมอนวดขอเอง",
  "เหตุผลด้านการทำงาน",
  "เจ้าของร้านสั่ง",
  "อื่น ๆ",
];

export const EVENT_LABEL: Record<string, string> = {
  check_in: "ลงคิว",
  received_customer: "รับลูกค้า",
  skipped_busy: "ถูกข้าม (กำลังนวด)",
  skipped_break: "ถูกข้าม (พัก)",
  skipped_outside: "ถูกข้าม (งานร้านอื่น)",
  skipped_off_duty: "ถูกข้าม (เลิกงาน)",
  finished_massage: "นวดเสร็จ",
  outside_job_start: "ออกไปรับงานร้านอื่น",
  outside_job_return: "กลับเข้าร้าน",
  status_change: "เปลี่ยนสถานะ",
  manual_override: "Admin เลือกเอง",
  extended: "ต่อเวลา",
  reordered: "ปรับลำดับคิว",
  voided: "ยกเลิกรายการ",
  day_closed: "ปิดวัน",
  group_received: "รับลูกค้าเป็นกลุ่ม",
  runner_called: "เรียกหมอวิ่งเข้ามา",
  runner_shortage: "หมอนวดในร้านไม่พอ",
  auto_finished: "ครบเวลา — ปิดงานอัตโนมัติ",
  session_edited: "แก้ไขรายการ",
};

export const EVENT_TONE: Record<string, string> = {
  received_customer: "text-jade-700",
  finished_massage: "text-emerald-700",
  skipped_busy: "text-orange-600",
  skipped_break: "text-slate-500",
  skipped_outside: "text-purple-600",
  skipped_off_duty: "text-slate-500",
  manual_override: "text-clay-500",
  voided: "text-red-600",
  extended: "text-jade-600",
  day_closed: "text-ink-600",
  group_received: "text-jade-700",
  runner_called: "text-amber-600",
  runner_shortage: "text-red-600",
  auto_finished: "text-emerald-700",
  session_edited: "text-clay-500",
};
