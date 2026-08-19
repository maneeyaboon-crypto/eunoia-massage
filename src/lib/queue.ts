/**
 * Queue rotation — the heart of the system.
 *
 * Rule (from the shop's spec):
 *   Round-robin queue with availability skipping.
 *   1. Daily queue order = check-in order (Admin may re-order).
 *   2. A pointer remembers who received the LAST customer.
 *   3. Scanning starts at the person AFTER the pointer — never from #1 again.
 *   4. Anyone not 🟢 Available is skipped (busy / finishing soon / expected
 *      finished / break / outside job / off duty).
 *   5. The first Available therapist found gets the customer.
 *   6. Being skipped is temporary — nobody leaves the rotation.
 *   7. The queue never waits for a busy therapist while someone is free.
 */

import type { DerivedStatus, ManualStatus } from "./types";

export interface ActiveSessionLite {
  id: string;
  therapist_id: string;
  expected_finish_at: string;
  service_name_en: string;
  service_name_th: string | null;
  customer_name: string | null;
  final_price: number;
  start_at: string;
  duration_min: number;
}

export interface QueueMemberInput {
  therapist_id: string;
  name: string;
  nickname?: string | null;
  position: number;
  status: ManualStatus;
}

export interface QueueMember extends QueueMemberInput {
  derived: DerivedStatus;
  remainingMin: number | null;
  activeSession: ActiveSessionLite | null;
  isAvailable: boolean;
}

export type SkipReason = "busy" | "break" | "outside_job" | "off_duty";

export interface SkipRecord {
  therapist_id: string;
  name: string;
  reason: SkipReason;
  detail: string;
}

export interface RotationResult {
  /** Ordered queue with derived status attached, sorted by position. */
  members: QueueMember[];
  /** The therapist the system suggests for the next customer (null = nobody free). */
  next: QueueMember | null;
  /** Members that were skipped while scanning towards `next`. */
  skipped: SkipRecord[];
  /** The scan order the rotation will follow from the pointer onwards. */
  rotationOrder: QueueMember[];
  /** Busy therapists ordered by who frees up soonest. */
  upcoming: QueueMember[];
}

/** Minutes left on an active massage, rounded UP so "0 min" only means finished. */
export function remainingMinutes(expectedFinishAt: string, now: Date): number {
  const ms = new Date(expectedFinishAt).getTime() - now.getTime();
  return Math.ceil(ms / 60000);
}

/**
 * Countdown colour bands.
 *   > 20 min      → 🔴 Busy
 *   10–20 min     → 🟠 Finishing Soon
 *   1–10 min      → 🔴 Urgent (very close to done)
 *   <= 0 min      → 🟢 Expected Finished — waiting for Admin confirmation
 * The therapist NEVER flips to Available on its own; Admin must press Finish.
 */
export function statusFromRemaining(remaining: number): DerivedStatus {
  if (remaining <= 0) return "expected_finished";
  if (remaining <= 10) return "urgent";
  if (remaining <= 20) return "finishing_soon";
  return "busy";
}

export function deriveMember(
  input: QueueMemberInput,
  activeSession: ActiveSessionLite | null,
  now: Date,
): QueueMember {
  if (activeSession) {
    const remainingMin = remainingMinutes(activeSession.expected_finish_at, now);
    return {
      ...input,
      activeSession,
      remainingMin,
      derived: statusFromRemaining(remainingMin),
      isAvailable: false,
    };
  }
  // No active massage → the manual status rules.
  const derived: DerivedStatus = input.status;
  return {
    ...input,
    activeSession: null,
    remainingMin: null,
    derived,
    isAvailable: input.status === "available",
  };
}

function skipReasonFor(m: QueueMember): SkipReason {
  switch (m.derived) {
    case "break":
      return "break";
    case "outside_job":
      return "outside_job";
    case "off_duty":
      return "off_duty";
    default:
      return "busy";
  }
}

function skipDetailFor(m: QueueMember): string {
  switch (m.derived) {
    case "break":
      return "ข้าม — พัก";
    case "outside_job":
      return "ข้าม — ไปรับงานร้านอื่น";
    case "off_duty":
      return "ข้าม — เลิกงานแล้ว";
    case "expected_finished":
      return "ข้าม — หมดเวลาแล้วแต่ยังไม่กดปิดงาน";
    default:
      return `ข้าม — กำลังนวด เหลือ ${m.remainingMin ?? "?"} นาที`;
  }
}

export function computeRotation(
  queue: QueueMemberInput[],
  activeSessions: ActiveSessionLite[],
  lastAssignedTherapistId: string | null,
  now: Date = new Date(),
): RotationResult {
  const byTherapist = new Map<string, ActiveSessionLite>();
  for (const s of activeSessions) byTherapist.set(s.therapist_id, s);

  const members = [...queue]
    .sort((a, b) => a.position - b.position)
    .map((q) => deriveMember(q, byTherapist.get(q.therapist_id) ?? null, now));

  const n = members.length;
  if (n === 0) {
    return { members, next: null, skipped: [], rotationOrder: [], upcoming: [] };
  }

  // Where does the scan start? Right AFTER whoever got the last customer.
  const pointerIdx = lastAssignedTherapistId
    ? members.findIndex((m) => m.therapist_id === lastAssignedTherapistId)
    : -1;
  const startIdx = pointerIdx >= 0 ? (pointerIdx + 1) % n : 0;

  const rotationOrder: QueueMember[] = [];
  for (let i = 0; i < n; i++) rotationOrder.push(members[(startIdx + i) % n]);

  const skipped: SkipRecord[] = [];
  let next: QueueMember | null = null;
  for (const m of rotationOrder) {
    if (m.isAvailable) {
      next = m;
      break;
    }
    skipped.push({
      therapist_id: m.therapist_id,
      name: m.name,
      reason: skipReasonFor(m),
      detail: skipDetailFor(m),
    });
  }

  // If nobody is available, the "skips" are not real skips — no assignment
  // happened. Report them for display but callers only log them on assignment.
  const upcoming = members
    .filter((m) => m.activeSession && m.remainingMin !== null)
    .sort((a, b) => (a.remainingMin ?? 0) - (b.remainingMin ?? 0));

  return { members, next, skipped, rotationOrder, upcoming };
}

/** Estimated wait for a specific therapist, in minutes. */
export function estimatedWaitFor(member: QueueMember): number | null {
  if (member.isAvailable) return 0;
  if (member.remainingMin !== null) return Math.max(member.remainingMin, 0);
  return null;
}

/* ------------------------------------------------------------------------- */
/* รับลูกค้าเป็นกลุ่ม — จ่ายคิวให้ครบทุกคนในรอบเดียว                              */
/* ------------------------------------------------------------------------- */

export interface PlannedSlot {
  /** ลูกค้าคนที่เท่าไหร่ในกลุ่ม (เริ่มที่ 1) */
  index: number;
  /** หมอนวดที่ระบบจ่ายให้ — null = ไม่มีใครว่าง ต้องเรียกหมอวิ่ง */
  member: QueueMember | null;
}

export interface AssignmentPlan {
  slots: PlannedSlot[];
  /** คนที่ถูกข้าม — นับคนละ 1 ครั้งต่อกลุ่มเท่านั้น ไม่ทบทุกช่อง */
  skipped: SkipRecord[];
  /** จำนวนลูกค้าที่ยังไม่มีหมอนวด (ต้องเรียกหมอวิ่ง หรือให้รอคิว) */
  shortage: number;
  assignedCount: number;
  /** ตัวชี้คิวหลังจ่ายกลุ่มนี้แล้ว */
  nextPointer: string | null;
}

/**
 * ลูกค้าเข้ามาพร้อมกันหลายคน → จ่ายหมอนวด 1 คนต่อลูกค้า 1 คน
 * วนคิวต่อเนื่องจากตัวชี้เดิม คนที่ได้งานในกลุ่มนี้แล้วจะไม่ถูกจ่ายซ้ำ
 * ถ้าหมอนวดว่างไม่พอ ช่องที่เหลือจะเป็น null = ต้องเรียกหมอวิ่งเข้ามา
 */
export function planAssignments(
  queue: QueueMemberInput[],
  activeSessions: ActiveSessionLite[],
  lastAssignedTherapistId: string | null,
  count: number,
  now: Date = new Date(),
): AssignmentPlan {
  const { members } = computeRotation(queue, activeSessions, lastAssignedTherapistId, now);
  const n = members.length;
  const wanted = Math.max(1, Math.floor(count) || 1);

  const slots: PlannedSlot[] = [];
  const skippedMap = new Map<string, SkipRecord>();
  const taken = new Set<string>();
  let pointer = lastAssignedTherapistId;

  for (let slot = 1; slot <= wanted; slot++) {
    let picked: QueueMember | null = null;

    if (n > 0) {
      const pi = pointer ? members.findIndex((m) => m.therapist_id === pointer) : -1;
      const start = pi >= 0 ? (pi + 1) % n : 0;

      for (let i = 0; i < n; i++) {
        const m = members[(start + i) % n];
        // ได้งานไปแล้วในกลุ่มนี้ — ข้ามเงียบ ๆ ไม่นับเป็นการถูกข้าม
        if (taken.has(m.therapist_id)) continue;
        if (m.isAvailable) {
          picked = m;
          break;
        }
        if (!skippedMap.has(m.therapist_id)) {
          skippedMap.set(m.therapist_id, {
            therapist_id: m.therapist_id,
            name: m.name,
            reason: skipReasonFor(m),
            detail: skipDetailFor(m),
          });
        }
      }
    }

    if (picked) {
      taken.add(picked.therapist_id);
      pointer = picked.therapist_id;
      slots.push({ index: slot, member: picked });
    } else {
      slots.push({ index: slot, member: null });
    }
  }

  const assignedCount = slots.filter((s) => s.member).length;
  return {
    slots,
    skipped: [...skippedMap.values()],
    shortage: wanted - assignedCount,
    assignedCount,
    nextPointer: pointer,
  };
}
