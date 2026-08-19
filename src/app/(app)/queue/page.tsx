"use client";

import { useMemo, useState } from "react";
import { useShop } from "@/components/ShopProvider";
import { supabaseBrowser } from "@/lib/supabase/client";
import { StatusPill, Modal, EmptyState, Toast } from "@/components/ui";
import { MANUAL_STATUS_OPTIONS } from "@/lib/status";
import { baht, hhmm } from "@/lib/format";
import { totalsByTherapist, totalsFor } from "@/lib/derive";
import type { ManualStatus, QueueRow } from "@/lib/types";

export default function QueuePage() {
  const { queue, therapists, todaySessions, rotation, runnerPool, workDate, refresh, dayClosed } =
    useShop();
  const supabase = supabaseBrowser();
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: "ok" | "err" } | null>(null);
  const [returning, setReturning] = useState<QueueRow | null>(null);
  const [runnerOpen, setRunnerOpen] = useState(false);
  const [runnerName, setRunnerName] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);

  const totals = useMemo(() => totalsByTherapist(todaySessions), [todaySessions]);
  const derivedById = useMemo(
    () => new Map(rotation.members.map((m) => [m.therapist_id, m])),
    [rotation.members],
  );

  const notCheckedIn = useMemo(() => {
    const inQueue = new Set(queue.map((q) => q.therapist_id));
    return therapists.filter((t) => t.is_active && !t.is_runner && !inQueue.has(t.id));
  }, [therapists, queue]);

  const runnerCount = queue.filter((q) => q.entry_type === "runner").length;

  /** ไม่ใส่ชื่อ = ระบบตั้งให้เป็น หมอวิ่ง 1, หมอวิ่ง 2 … */
  async function callRunner(name?: string) {
    await run(async () => {
      const { error } = await supabase.rpc("add_runner", {
        p_name: (name ?? runnerName).trim() || null,
      });
      if (error) throw error;
      setRunnerOpen(false);
      setRunnerName("");
    }, "เรียกหมอวิ่งเข้ามาแล้ว");
  }

  function flash(message: string, tone: "ok" | "err" = "ok") {
    setToast({ message, tone });
    setTimeout(() => setToast(null), 2600);
  }

  async function run(fn: () => Promise<void>, okMsg?: string) {
    setBusy(true);
    try {
      await fn();
      await refresh();
      if (okMsg) flash(okMsg);
    } catch (err) {
      flash(err instanceof Error ? err.message : "ทำรายการไม่สำเร็จ", "err");
    } finally {
      setBusy(false);
    }
  }

  async function checkIn(therapistId: string) {
    await run(async () => {
      const maxPos = queue.reduce((m, q) => Math.max(m, q.position), 0);
      const { error } = await supabase.from("daily_queue").insert({
        work_date: workDate,
        therapist_id: therapistId,
        position: maxPos + 1,
        status: "available",
      });
      if (error) throw error;
      const name = therapists.find((t) => t.id === therapistId)?.name ?? "";
      await supabase.from("queue_events").insert({
        work_date: workDate,
        event_type: "check_in",
        therapist_id: therapistId,
        detail: `ลงคิว #${maxPos + 1} — ${name}`,
      });
    }, "ลงคิวเรียบร้อย");
  }

  async function removeFromQueue(row: QueueRow) {
    if (!confirm(`เอา ${row.therapist.name} ออกจากคิววันนี้?`)) return;
    await run(async () => {
      const { error } = await supabase.from("daily_queue").delete().eq("id", row.id);
      if (error) throw new Error("ลบไม่ได้ — หมอนวดคนนี้มีงานวันนี้แล้ว (ใช้ 'เลิกงาน' แทน)");
      await resequence(queue.filter((q) => q.id !== row.id).map((q) => q.therapist_id));
    }, "เอาออกจากคิวแล้ว");
  }

  async function resequence(orderedTherapistIds: string[]) {
    const { error } = await supabase.rpc("reorder_queue", {
      p_work_date: workDate,
      p_therapist_ids: orderedTherapistIds,
    });
    if (error) throw error;
  }

  async function move(row: QueueRow, dir: -1 | 1) {
    const ids = queue.map((q) => q.therapist_id);
    const i = ids.indexOf(row.therapist_id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await run(() => resequence(ids));
  }

  async function dropOn(target: QueueRow) {
    if (!dragId || dragId === target.therapist_id) return;
    const ids = queue.map((q) => q.therapist_id).filter((id) => id !== dragId);
    const at = ids.indexOf(target.therapist_id);
    ids.splice(at, 0, dragId);
    setDragId(null);
    await run(() => resequence(ids));
  }

  async function setStatus(row: QueueRow, status: ManualStatus) {
    if (status === row.status) return;
    const active = rotation.members.find((m) => m.therapist_id === row.therapist_id)?.activeSession;
    if (active && status !== "available") {
      flash("หมอนวดกำลังนวดอยู่ — กดปุ่ม “นวดเสร็จ” ก่อน", "err");
      return;
    }

    await run(async () => {
      const { error } = await supabase
        .from("daily_queue")
        .update({ status })
        .eq("id", row.id);
      if (error) throw error;

      if (status === "outside_job") {
        await supabase.from("outside_job_logs").insert({
          work_date: workDate,
          therapist_id: row.therapist_id,
        });
        await supabase.from("queue_events").insert({
          work_date: workDate,
          event_type: "outside_job_start",
          therapist_id: row.therapist_id,
          detail: "ออกไปรับงานร้านอื่น",
        });
      } else {
        await supabase.from("queue_events").insert({
          work_date: workDate,
          event_type: "status_change",
          therapist_id: row.therapist_id,
          detail: `เปลี่ยนสถานะเป็น ${MANUAL_STATUS_OPTIONS.find((o) => o.value === status)?.label}`,
        });
      }
    }, "อัปเดตสถานะแล้ว");
  }

  async function returnToQueue(row: QueueRow, mode: "same_position" | "end_of_queue") {
    setReturning(null);
    await run(async () => {
      const { data: logs } = await supabase
        .from("outside_job_logs")
        .select("id")
        .eq("work_date", workDate)
        .eq("therapist_id", row.therapist_id)
        .is("returned_at", null)
        .order("left_at", { ascending: false })
        .limit(1);

      if (logs?.[0]) {
        await supabase
          .from("outside_job_logs")
          .update({ returned_at: new Date().toISOString(), return_mode: mode })
          .eq("id", logs[0].id);
      }

      const { error } = await supabase
        .from("daily_queue")
        .update({ status: "available" })
        .eq("id", row.id);
      if (error) throw error;

      if (mode === "end_of_queue") {
        const ids = queue
          .map((q) => q.therapist_id)
          .filter((id) => id !== row.therapist_id);
        ids.push(row.therapist_id);
        await resequence(ids);
      }

      await supabase.from("queue_events").insert({
        work_date: workDate,
        event_type: "outside_job_return",
        therapist_id: row.therapist_id,
        detail: mode === "same_position" ? "กลับเข้าตำแหน่งเดิม" : "กลับไปต่อท้ายคิว",
      });
    }, "กลับเข้าคิวแล้ว");
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink-800">คิวหมอนวดวันนี้</h1>
          <p className="mt-1 text-sm text-ink-400">
            ใครมาลงคิวก่อน = ได้คิวก่อน · ลากสลับหรือกดลูกศรเพื่อปรับลำดับ
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="rounded-xl bg-white px-4 py-2.5 text-sm shadow-card ring-1 ring-sand-200">
            <span className="text-ink-400">ลงคิววันนี้ </span>
            <span className="font-bold text-ink-800">{queue.length}</span>
            <span className="text-ink-400"> คน · ว่าง </span>
            <span className="font-bold text-emerald-600">
              {rotation.members.filter((m) => m.isAvailable).length}
            </span>
            {runnerCount > 0 && (
              <>
                <span className="text-ink-400"> · หมอวิ่ง </span>
                <span className="font-bold text-amber-600">{runnerCount}</span>
              </>
            )}
          </div>
          <button className="btn-primary !bg-amber-600 hover:!bg-amber-700" disabled={busy}
            onClick={() => void callRunner("")}>
            ⚡ เรียกหมอวิ่ง
          </button>
          <button
            className="btn-ghost btn-sm"
            onClick={() => {
              setRunnerName("");
              setRunnerOpen(true);
            }}
          >
            ระบุชื่อเอง
          </button>
        </div>
      </div>

      {dayClosed && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200">
          วันนี้ปิดยอดแล้ว — การแก้ไขเพิ่มเติมจะไม่อยู่ในสำเนาที่บันทึกไว้ ต้องกดปิดวันใหม่
        </p>
      )}

      {/* Check-in strip */}
      <section className="card card-pad">
        <p className="section-title mb-3">ลงชื่อเข้าทำงาน</p>
        {notCheckedIn.length === 0 ? (
          <p className="text-sm text-ink-400">หมอนวดที่เปิดใช้งานลงคิวครบแล้ว</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {notCheckedIn.map((t) => (
              <button
                key={t.id}
                disabled={busy}
                onClick={() => checkIn(t.id)}
                className="btn-secondary"
              >
                + {t.name}
                {t.nickname && <span className="text-ink-400">({t.nickname})</span>}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Queue cards */}
      {queue.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="📋"
            title="ยังไม่มีใครลงคิววันนี้"
            hint="กดชื่อหมอนวดด้านบนเพื่อลงคิว — ลำดับจะเรียงตามเวลาที่ลงชื่อ"
          />
        </div>
      ) : (
        <ul className="space-y-3">
          {queue.map((row, idx) => {
            const m = derivedById.get(row.therapist_id);
            const tot = totalsFor(totals, row.therapist_id);
            const isNext = rotation.next?.therapist_id === row.therapist_id;
            return (
              <li
                key={row.id}
                draggable
                onDragStart={() => setDragId(row.therapist_id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => void dropOn(row)}
                className={`card overflow-hidden border-l-4 ${
                  m ? (isNext ? "border-l-jade-600" : `border-l-transparent`) : "border-l-transparent"
                } ${dragId === row.therapist_id ? "opacity-50" : ""}`}
              >
                <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
                  {/* rank + reorder */}
                  <div className="flex items-center gap-3">
                    <div className="flex flex-col gap-1">
                      <button
                        className="flex h-8 w-8 items-center justify-center rounded-lg bg-sand-100 text-ink-500 disabled:opacity-30"
                        onClick={() => void move(row, -1)}
                        disabled={busy || idx === 0}
                        aria-label="เลื่อนขึ้น"
                      >
                        ▲
                      </button>
                      <button
                        className="flex h-8 w-8 items-center justify-center rounded-lg bg-sand-100 text-ink-500 disabled:opacity-30"
                        onClick={() => void move(row, 1)}
                        disabled={busy || idx === queue.length - 1}
                        aria-label="เลื่อนลง"
                      >
                        ▼
                      </button>
                    </div>
                    <span className="w-12 shrink-0 text-center text-2xl font-bold tabular-nums text-ink-300">
                      #{row.position}
                    </span>
                  </div>

                  {/* identity */}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-lg font-bold text-ink-800">{row.therapist.name}</p>
                      {row.entry_type === "runner" && (
                        <span className="pill bg-amber-100 text-amber-800 ring-1 ring-amber-300">
                          ⚡ หมอวิ่ง
                        </span>
                      )}
                      {row.therapist.nickname && (
                        <span className="text-sm text-ink-400">{row.therapist.nickname}</span>
                      )}
                      {m && <StatusPill status={m.derived} remainingMin={m.remainingMin} />}
                      {isNext && (
                        <span className="pill bg-jade-600 text-white">🥇 คิวถัดไป</span>
                      )}
                    </div>
                    <p className="mt-1.5 text-xs text-ink-400">
                      ลงคิว {hhmm(row.checked_in_at)} · งานวันนี้{" "}
                      <span className="font-semibold text-ink-600">{tot.jobs}</span> · ค่าแรง{" "}
                      <span className="font-semibold text-ink-600">{baht(tot.pay)}</span> · ยอดขาย{" "}
                      <span className="font-semibold text-ink-600">{baht(tot.sales)}</span>
                    </p>
                    {m?.activeSession && (
                      <p className="mt-1 text-xs text-red-600">
                        กำลังนวด: {m.activeSession.service_name_th ?? m.activeSession.service_name_en}{" "}
                        · เสร็จ {hhmm(m.activeSession.expected_finish_at)}
                      </p>
                    )}
                  </div>

                  {/* actions */}
                  <div className="flex flex-wrap items-center gap-2">
                    {row.status === "outside_job" ? (
                      <button className="btn-primary btn-sm" onClick={() => setReturning(row)}>
                        ↩ กลับเข้าคิว
                      </button>
                    ) : (
                      <button
                        className="btn-secondary btn-sm"
                        disabled={busy || !!m?.activeSession}
                        onClick={() => void setStatus(row, "outside_job")}
                      >
                        🟣 ออกไปงานร้านอื่น
                      </button>
                    )}

                    <select
                      className="h-10 rounded-xl bg-sand-50 px-3 text-sm ring-1 ring-sand-300"
                      value={row.status}
                      disabled={busy}
                      onChange={(e) => void setStatus(row, e.target.value as ManualStatus)}
                    >
                      {MANUAL_STATUS_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>

                    <button
                      className="btn-ghost btn-sm text-red-500"
                      disabled={busy || tot.jobs > 0}
                      onClick={() => void removeFromQueue(row)}
                      title={tot.jobs > 0 ? "มีงานแล้ว ลบไม่ได้" : "เอาออกจากคิว"}
                    >
                      ลบ
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Modal
        open={runnerOpen}
        onClose={() => setRunnerOpen(false)}
        title="⚡ เรียกหมอวิ่งเข้ามา"
        footer={
          <div className="flex gap-3">
            <button className="btn-secondary flex-1" onClick={() => setRunnerOpen(false)}>
              ยกเลิก
            </button>
            <button
              className="btn-primary flex-1"
              disabled={busy}
              onClick={() => void callRunner()}
            >
              เรียกเข้ามา
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-ink-500">
            หมอวิ่งคือหมอนวดนอกร้านที่เรียกมาเสริมตอนคนในร้านไม่พอ — จะถูกลงคิวต่อท้ายของวันนี้
            และนับยอด/ค่าแรงแยกให้เห็นชัดในรายงาน
          </p>
          {runnerPool.length > 0 && (
            <div>
              <label className="label">เลือกจากหมอวิ่งที่มีอยู่</label>
              <div className="flex flex-wrap gap-2">
                {runnerPool.map((t) => (
                  <button
                    key={t.id}
                    className="btn-secondary btn-sm"
                    onClick={() => setRunnerName(t.name)}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div>
            <label className="label">ชื่อหมอวิ่ง (ไม่บังคับ)</label>
            <input
              className="input"
              value={runnerName}
              onChange={(e) => setRunnerName(e.target.value)}
              placeholder="เว้นว่างไว้ = หมอวิ่ง 1, หมอวิ่ง 2 …"
            />
            <p className="mt-1 text-xs text-ink-400">
              ไม่ต้องกรอกก็ได้ ระบบจะตั้งชื่อให้เป็น หมอวิ่ง 1 · หมอวิ่ง 2 ไล่ไปเรื่อย ๆ
              ถ้าอยากใส่ชื่อจริงก็พิมพ์ได้
            </p>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!returning}
        onClose={() => setReturning(null)}
        title={`${returning?.therapist.name ?? ""} กลับเข้าร้าน`}
        footer={
          <div className="flex gap-3">
            <button
              className="btn-primary flex-1"
              onClick={() => returning && void returnToQueue(returning, "same_position")}
            >
              กลับตำแหน่งเดิม (#{returning?.position})
            </button>
            <button
              className="btn-secondary flex-1"
              onClick={() => returning && void returnToQueue(returning, "end_of_queue")}
            >
              ไปต่อท้ายคิว
            </button>
          </div>
        }
      >
        <p className="text-sm text-ink-500">
          ระบบจะบันทึกเวลาที่ออกไปและเวลาที่กลับเข้าร้านไว้ในประวัติงานร้านอื่น
        </p>
      </Modal>

      {toast && <Toast message={toast.message} tone={toast.tone} />}
    </div>
  );
}
