"use client";

import { useEffect, useState } from "react";
import { useShop } from "./ShopProvider";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Modal } from "./ui";
import { PAYMENT_METHODS } from "@/lib/status";
import { baht, bangkokTimeToIso, hhmm, nowHHmm } from "@/lib/format";
import type { MassageSession, PaymentMethod } from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Finish Massage                                                      */
/* ------------------------------------------------------------------ */

export function FinishDialog({
  session,
  onClose,
  onDone,
}: {
  session: MassageSession | null;
  onClose: () => void;
  onDone?: (msg: string, tone: "ok" | "err") => void;
}) {
  const { workDate, refresh } = useShop();
  const supabase = supabaseBrowser();
  const [finishTime, setFinishTime] = useState(() => nowHHmm());
  const [finalPrice, setFinalPrice] = useState("");
  const [pay, setPay] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    setFinishTime(nowHHmm());
    setFinalPrice(String(session.final_price));
    setPay(String(session.actual_therapist_pay));
    setMethod(session.payment_method ?? "cash");
    setErr(null);
  }, [session]);

  if (!session) return null;

  const finalNum = Number(finalPrice || 0);
  const payNum = Number(pay || 0);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const { error } = await supabase.rpc("finish_session", {
        p_session_id: session!.id,
        p_finished_at: bangkokTimeToIso(workDate, finishTime),
        p_payment_method: method,
        p_final_price: finalNum,
        p_actual_pay: payNum,
      });
      if (error) throw error;
      await refresh();
      onDone?.(`ปิดงานแล้ว — เก็บ ${baht(finalNum)}`, "ok");
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "ปิดงานไม่สำเร็จ";
      setErr(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={!!session}
      onClose={onClose}
      title="จบการนวด"
      footer={
        <div className="space-y-3">
          {err && (
            <p className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-700 ring-1 ring-red-200">
              {err}
            </p>
          )}
          <div className="flex gap-3">
            <button className="btn-secondary flex-1" onClick={onClose}>
              ยกเลิก
            </button>
            <button className="btn-primary flex-1" disabled={busy} onClick={() => void submit()}>
              ปิดงาน · {baht(finalNum)}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="rounded-xl bg-sand-100 px-4 py-3 text-sm">
          <p className="font-semibold text-ink-800">
            {session.service_name_th || session.service_name_en}
            <span className="ml-2 font-normal text-ink-400">{session.duration_min} นาที</span>
          </p>
          <p className="mt-0.5 text-ink-500">
            {session.customer_name || "ลูกค้าเดินเข้า"} · เริ่ม {hhmm(session.start_at)} · กำหนดเสร็จ{" "}
            {hhmm(session.expected_finish_at)} · {session.code}
          </p>
        </div>

        <div>
          <label className="label">เวลาที่นวดเสร็จจริง</label>
          <div className="flex gap-2">
            <input
              className="input w-40"
              type="time"
              value={finishTime}
              onChange={(e) => setFinishTime(e.target.value)}
            />
            <button className="btn-secondary" onClick={() => setFinishTime(nowHHmm())}>
              ตอนนี้
            </button>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">ราคาขายจริง (฿)</label>
            <input
              className="input font-bold"
              type="number"
              inputMode="decimal"
              value={finalPrice}
              onChange={(e) => setFinalPrice(e.target.value)}
            />
            <p className="mt-1 text-[11px] text-ink-400">
              ราคาตั้ง {baht(session.original_price)} · ส่วนลด{" "}
              {baht(Math.max(0, Number(session.original_price) - finalNum))}
            </p>
          </div>
          <div>
            <label className="label">ค่าแรงหมอนวด (฿)</label>
            <input
              className="input font-bold"
              type="number"
              inputMode="decimal"
              value={pay}
              onChange={(e) => setPay(e.target.value)}
            />
            <p className="mt-1 text-[11px] text-ink-400">
              ค่าเริ่มต้น {baht(session.default_therapist_pay)}
            </p>
          </div>
        </div>

        <div>
          <label className="label">ช่องทางชำระเงิน</label>
          <div className="grid grid-cols-2 gap-2">
            {PAYMENT_METHODS.map((p) => (
              <button
                key={p.value}
                onClick={() => setMethod(p.value)}
                className={`rounded-xl px-4 py-3 text-sm font-semibold transition ${
                  method === p.value
                    ? "bg-jade-600 text-white shadow-card"
                    : "bg-white ring-1 ring-sand-300 hover:bg-sand-50"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <p className="rounded-xl bg-jade-50 px-4 py-3 text-sm text-jade-800 ring-1 ring-jade-200">
          ร้านได้สุทธิจากงานนี้{" "}
          <strong className="tabular-nums">{baht(finalNum - payNum)}</strong>
        </p>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Extend Massage                                                      */
/* ------------------------------------------------------------------ */

export function ExtendDialog({
  session,
  preset,
  onClose,
  onDone,
}: {
  session: MassageSession | null;
  preset?: number;
  onClose: () => void;
  onDone?: (msg: string, tone: "ok" | "err") => void;
}) {
  const { services, refresh } = useShop();
  const supabase = supabaseBrowser();
  const [minutes, setMinutes] = useState(30);
  const [addPrice, setAddPrice] = useState("");
  const [addPay, setAddPay] = useState("");
  const [extraServiceId, setExtraServiceId] = useState<string>("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    const m = preset ?? 30;
    setMinutes(m);
    const svc = services.find((s) => s.id === session.service_id);
    if (preset && svc && svc.duration_min > 0) {
      setAddPrice(String(Math.round((Number(svc.price) / svc.duration_min) * m)));
      setAddPay(String(Math.round((Number(svc.default_therapist_pay) / svc.duration_min) * m)));
    } else {
      setAddPrice("");
      setAddPay("");
    }
    setExtraServiceId("");
    setNote("");
    setErr(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, preset]);

  if (!session) return null;

  function pickPreset(m: number) {
    setMinutes(m);
    // Suggest a price from the same service pro-rated to the added time.
    const svc = services.find((s) => s.id === session!.service_id);
    if (svc && svc.duration_min > 0) {
      setAddPrice(String(Math.round((Number(svc.price) / svc.duration_min) * m)));
      setAddPay(String(Math.round((Number(svc.default_therapist_pay) / svc.duration_min) * m)));
    }
  }

  function pickExtraService(id: string) {
    setExtraServiceId(id);
    const svc = services.find((s) => s.id === id);
    if (svc) {
      setMinutes(svc.duration_min);
      setAddPrice(String(svc.price));
      setAddPay(String(svc.default_therapist_pay));
    }
  }

  const newFinish = new Date(
    new Date(session.expected_finish_at).getTime() + minutes * 60000,
  ).toISOString();

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const { error } = await supabase.rpc("extend_session", {
        p_session_id: session!.id,
        p_minutes: minutes,
        p_add_price: Number(addPrice || 0),
        p_add_pay: Number(addPay || 0),
        p_extra_service_id: extraServiceId || null,
        p_note: note.trim() || null,
      });
      if (error) throw error;
      await refresh();
      onDone?.(`ต่อเวลา +${minutes} นาที · เสร็จใหม่ ${hhmm(newFinish)}`, "ok");
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "ต่อเวลาไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={!!session}
      onClose={onClose}
      title="ต่อเวลานวด"
      footer={
        <div className="space-y-3">
          {err && (
            <p className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-700 ring-1 ring-red-200">
              {err}
            </p>
          )}
          <div className="flex gap-3">
            <button className="btn-secondary flex-1" onClick={onClose}>
              ยกเลิก
            </button>
            <button className="btn-primary flex-1" disabled={busy} onClick={() => void submit()}>
              + ต่อเวลา {minutes} นาที
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="rounded-xl bg-sand-100 px-4 py-3 text-sm">
          <p className="text-ink-500">
            เดิมเสร็จ <strong className="tabular-nums">{hhmm(session.expected_finish_at)}</strong> →
            ใหม่ <strong className="tabular-nums text-jade-700">{hhmm(newFinish)}</strong>
          </p>
        </div>

        <div>
          <label className="label">เพิ่มเวลา</label>
          <div className="flex flex-wrap gap-2">
            {[30, 60].map((m) => (
              <button
                key={m}
                onClick={() => pickPreset(m)}
                className={`rounded-xl px-5 py-3 text-sm font-bold ${
                  minutes === m && !extraServiceId
                    ? "bg-jade-600 text-white"
                    : "bg-white ring-1 ring-sand-300"
                }`}
              >
                +{m} นาที
              </button>
            ))}
            <input
              className="input w-32"
              type="number"
              inputMode="numeric"
              value={minutes}
              onChange={(e) => setMinutes(Math.max(1, Number(e.target.value || 1)))}
              aria-label="กำหนดนาทีเอง"
            />
          </div>
        </div>

        <div>
          <label className="label">หรือเพิ่มบริการ (ไม่บังคับ)</label>
          <select
            className="input"
            value={extraServiceId}
            onChange={(e) => pickExtraService(e.target.value)}
          >
            <option value="">— ไม่เพิ่มบริการ —</option>
            {services
              .filter((s) => s.is_active)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name_th || s.name_en} · {baht(s.price)} · {s.duration_min} น.
                </option>
              ))}
          </select>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">เพิ่มราคาขาย (฿)</label>
            <input
              className="input font-bold"
              type="number"
              inputMode="decimal"
              value={addPrice}
              onChange={(e) => setAddPrice(e.target.value)}
            />
          </div>
          <div>
            <label className="label">เพิ่มค่าแรงหมอนวด (฿)</label>
            <input
              className="input font-bold"
              type="number"
              inputMode="decimal"
              value={addPay}
              onChange={(e) => setAddPay(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className="label">โน้ต</label>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        <p className="text-xs text-ink-400">
          ยอดใหม่: ราคาขาย {baht(Number(session.final_price) + Number(addPrice || 0))} · ค่าแรง{" "}
          {baht(Number(session.actual_therapist_pay) + Number(addPay || 0))}
        </p>
      </div>
    </Modal>
  );
}
