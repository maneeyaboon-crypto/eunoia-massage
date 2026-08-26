"use client";

import { useShop } from "./ShopProvider";
import { STATUS } from "@/lib/status";
import { baht, hhmm } from "@/lib/format";
import { remainingMinutes, statusFromRemaining } from "@/lib/queue";
import type { MassageSession } from "@/lib/types";

export default function ActiveSessionCard({
  session,
  onFinish,
  onExtend,
  onQuickExtend,
}: {
  session: MassageSession;
  onFinish: () => void;
  onExtend: () => void;
  onQuickExtend?: (minutes: number) => void;
}) {
  const { now, therapists } = useShop();
  const therapist = therapists.find((t) => t.id === session.therapist_id);

  const remaining = remainingMinutes(session.expected_finish_at, now);
  const status = statusFromRemaining(remaining);
  const meta = STATUS[status];

  const totalMs =
    new Date(session.expected_finish_at).getTime() - new Date(session.start_at).getTime();
  const elapsedMs = now.getTime() - new Date(session.start_at).getTime();
  const progress = Math.min(100, Math.max(0, (elapsedMs / Math.max(1, totalMs)) * 100));

  const overtimeMin = remaining < 0 ? Math.abs(remaining) : 0;
  const showQuickExtend = remaining <= 10;

  return (
    <div className={`card overflow-hidden border-l-4 ${meta.border}`}>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 truncate text-lg font-bold text-ink-800">
              {therapist?.name ?? "—"}
              {session.is_runner_job && (
                <span className="pill bg-amber-100 text-amber-800 ring-1 ring-amber-300">
                  หมอวิ่ง
                </span>
              )}
              {session.group_size > 1 && (
                <span className="pill bg-jade-50 text-jade-700 ring-1 ring-jade-200">
                  กลุ่ม {session.group_size} คน · คนที่ {session.group_index}
                </span>
              )}
              {therapist?.nickname && (
                <span className="ml-2 text-sm font-normal text-ink-400">{therapist.nickname}</span>
              )}
            </p>
            <p className="truncate text-sm text-ink-500">
              {session.service_name_th || session.service_name_en}
              <span className="text-ink-300"> · </span>
              {session.customer_name || "ลูกค้าเดินเข้า"}
              {session.customer_count > 1 && (
                <span className="text-ink-400"> ({session.customer_count} คน)</span>
              )}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p
              className={`text-3xl font-bold tabular-nums leading-none ${
                status === "expected_finished"
                  ? "text-green-600"
                  : status === "urgent"
                    ? "text-rose-600"
                    : status === "finishing_soon"
                      ? "text-orange-600"
                      : "text-red-600"
              }`}
            >
              {remaining > 0 ? remaining : overtimeMin > 0 ? `+${overtimeMin}` : 0}
              <span className="ml-1 text-sm font-medium">น.</span>
            </p>
            <p className="mt-0.5 text-[11px] text-ink-400">
              {remaining > 0 ? "เหลืออีก" : "เกินเวลา"}
            </p>
          </div>
        </div>

        {/* progress */}
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-sand-200">
          <div
            className={`h-full rounded-full transition-all ${meta.solid}`}
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-500">
          <span>
            เริ่ม <strong className="tabular-nums text-ink-700">{hhmm(session.start_at)}</strong>
          </span>
          <span>
            เสร็จ{" "}
            <strong className="tabular-nums text-ink-700">{hhmm(session.expected_finish_at)}</strong>
          </span>
          <span>
            {session.duration_min} นาที · <strong className="text-ink-700">{baht(session.final_price)}</strong>
          </span>
          {Number(session.discount) > 0 && (
            <span className="text-clay-500">ลด {baht(session.discount)}</span>
          )}
          {session.is_customer_request && <span className="text-jade-600">ลูกค้าขอคนนี้</span>}
        </div>

        {session.note && (
          <p className="mt-2 rounded-lg bg-sand-100 px-3 py-2 text-xs text-ink-500">
            {session.note}
          </p>
        )}

        {status === "expected_finished" && (
          <p className="mt-3 rounded-xl bg-green-50 px-3 py-2.5 text-xs font-semibold text-green-800 ring-1 ring-green-200">
            หมดเวลาแล้ว — รอกดปุ่ม &quot;นวดเสร็จ&quot;
            <span className="block font-normal text-green-700">
              ระบบไม่เปลี่ยนเป็นว่างเอง เพราะลูกค้าอาจนวดเกินเวลา
            </span>
          </p>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn-primary flex-1" onClick={onFinish}>
            นวดเสร็จ
          </button>
          {showQuickExtend && onQuickExtend ? (
            <>
              <button className="btn-secondary" onClick={() => onQuickExtend(30)}>
                +30 นาที
              </button>
              <button className="btn-secondary" onClick={() => onQuickExtend(60)}>
                +60 นาที
              </button>
            </>
          ) : (
            <button className="btn-secondary" onClick={onExtend}>
              + ต่อเวลา
            </button>
          )}
          {showQuickExtend && (
            <button className="btn-ghost btn-sm" onClick={onExtend}>
              ต่อเวลาแบบกำหนดเอง
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
