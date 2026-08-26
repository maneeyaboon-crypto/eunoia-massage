"use client";

import { useState } from "react";
import { useShop } from "./ShopProvider";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Modal, EmptyState } from "./ui";
import { hhmm, minutesLabel } from "@/lib/format";
import type { Prefill } from "./NewCustomerDrawer";

export default function WaitingPanel({ onSeat }: { onSeat: (p: Prefill) => void }) {
  const { waiting, services, therapists, rotation, workDate, refresh } = useShop();
  const supabase = supabaseBrowser();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [count, setCount] = useState(1);
  const [serviceId, setServiceId] = useState("");
  const [therapistId, setTherapistId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  function waitFor(therapistId: string | null): string {
    if (!therapistId) {
      const soonest = rotation.upcoming[0];
      if (rotation.next) return "มีหมอนวดว่างแล้ว";
      return soonest ? `ประมาณ ${Math.max(0, soonest.remainingMin ?? 0)} นาที` : "—";
    }
    const m = rotation.members.find((x) => x.therapist_id === therapistId);
    if (!m) return "ไม่ได้ลงคิววันนี้";
    if (m.isAvailable) return "ว่างแล้ว";
    if (m.remainingMin != null)
      return `ประมาณ ${Math.max(0, m.remainingMin)} นาที`;
    return m.derived === "outside_job" ? "ไปงานร้านอื่น" : "ยังไม่ว่าง";
  }

  async function add() {
    setBusy(true);
    try {
      await supabase.from("waiting_customers").insert({
        work_date: workDate,
        customer_name: name.trim() || null,
        customer_count: count,
        requested_service_id: serviceId || null,
        requested_therapist_id: therapistId || null,
        note: note.trim() || null,
      });
      setAdding(false);
      setName("");
      setCount(1);
      setServiceId("");
      setTherapistId("");
      setNote("");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    await supabase.from("waiting_customers").update({ status: "cancelled" }).eq("id", id);
    await refresh();
  }

  return (
    <section className="card">
      <div className="flex items-center justify-between border-b border-sand-200 px-4 py-3">
        <p className="section-title">รอคิว ({waiting.length})</p>
        <button className="btn-ghost btn-sm text-jade-700" onClick={() => setAdding(true)}>
          + เพิ่ม
        </button>
      </div>

      {waiting.length === 0 ? (
        <EmptyState title="ไม่มีลูกค้ารอคิว" />
      ) : (
        <ul className="divide-y divide-sand-100">
          {waiting.map((w) => {
            const svc = services.find((s) => s.id === w.requested_service_id);
            const th = therapists.find((t) => t.id === w.requested_therapist_id);
            return (
              <li key={w.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink-800">
                      {w.customer_name || "ลูกค้าเดินเข้า"}
                      {w.customer_count > 1 && (
                        <span className="text-ink-400"> ({w.customer_count} คน)</span>
                      )}
                    </p>
                    <p className="truncate text-xs text-ink-400">
                      {svc ? svc.name_th || svc.name_en : "ยังไม่เลือกบริการ"}
                      {th && <span className="text-jade-600"> · ขอ {th.name}</span>}
                    </p>
                    <p className="mt-0.5 text-[11px] text-ink-400">
                      มาถึง {hhmm(w.arrival_at)} · รอ{" "}
                      <span className="font-semibold text-ink-600">
                        {waitFor(w.requested_therapist_id)}
                      </span>
                    </p>
                    {w.note && <p className="mt-1 text-[11px] text-ink-400">{w.note}</p>}
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    <button
                      className="btn-primary btn-sm"
                      onClick={() =>
                        onSeat({
                          customerName: w.customer_name,
                          customerCount: w.customer_count,
                          serviceId: w.requested_service_id,
                          therapistId: w.requested_therapist_id,
                          note: w.note,
                          waitingId: w.id,
                          isCustomerRequest: !!w.requested_therapist_id,
                        })
                      }
                    >
                      รับเข้า
                    </button>
                    <button className="btn-ghost btn-sm text-red-500" onClick={() => void cancel(w.id)}>
                      ยกเลิก
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title="เพิ่มลูกค้ารอคิว"
        footer={
          <div className="flex gap-3">
            <button className="btn-secondary flex-1" onClick={() => setAdding(false)}>
              ยกเลิก
            </button>
            <button className="btn-primary flex-1" disabled={busy} onClick={() => void add()}>
              บันทึก
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">ชื่อลูกค้า</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="label">จำนวน</label>
              <input
                className="input"
                type="number"
                min={1}
                value={count}
                onChange={(e) => setCount(Math.max(1, Number(e.target.value || 1)))}
              />
            </div>
          </div>
          <div>
            <label className="label">บริการที่ต้องการ</label>
            <select className="input" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
              <option value="">— ยังไม่เลือก —</option>
              {services
                .filter((s) => s.is_active)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name_th || s.name_en}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label className="label">ขอหมอนวดคนไหน (ไม่บังคับ)</label>
            <select
              className="input"
              value={therapistId}
              onChange={(e) => setTherapistId(e.target.value)}
            >
              <option value="">— ไม่ระบุ (ตามคิว) —</option>
              {rotation.members.map((m) => (
                <option key={m.therapist_id} value={m.therapist_id}>
                  #{m.position} {m.name}
                  {m.remainingMin != null ? ` (เหลือ ${Math.max(0, m.remainingMin)} น.)` : ""}
                </option>
              ))}
            </select>
            {therapistId && (
              <p className="mt-1 text-xs text-jade-700">
                {(() => {
                  const m = rotation.members.find((x) => x.therapist_id === therapistId);
                  if (!m) return "";
                  if (m.isAvailable) return `${m.name} ว่างแล้ว — รับเข้าได้เลย`;
                  return `${m.name} จะว่างในอีกประมาณ ${minutesLabel(Math.max(0, m.remainingMin ?? 0))}`;
                })()}
              </p>
            )}
          </div>
          <div>
            <label className="label">โน้ต</label>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
      </Modal>
    </section>
  );
}
