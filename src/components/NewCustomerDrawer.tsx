"use client";

import { useEffect, useMemo, useState } from "react";
import { useShop } from "./ShopProvider";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Drawer, StatusPill, Modal } from "./ui";
import { OVERRIDE_REASONS } from "@/lib/status";
import { baht, bangkokTimeToIso, hhmm, nowHHmm } from "@/lib/format";
import { defaultPayFor } from "@/lib/pricing";
import type { Service } from "@/lib/types";

export interface Prefill {
  customerName?: string | null;
  customerCount?: number;
  serviceId?: string | null;
  therapistId?: string | null;
  note?: string | null;
  waitingId?: string;
  isCustomerRequest?: boolean;
}

/** หนึ่งแถว = ลูกค้าหนึ่งคน = หมอนวดหนึ่งคน */
interface Row {
  key: number;
  customerName: string;
  serviceId: string | null;
  therapistId: string | null;
  /** true = ช่องนี้ยังไม่มีหมอนวด ต้องเรียกหมอวิ่ง */
  needsRunner: boolean;
  isRunnerJob: boolean;
  finalPrice: string;
  pay: string;
  durationMin: string;
  isRequest: boolean;
  reason: string;
}

export default function NewCustomerDrawer({
  open,
  onClose,
  prefill,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  prefill?: Prefill;
  onDone?: (msg: string, tone: "ok" | "err") => void;
}) {
  const { services, therapists, rotation, planFor, runnerPool, workDate, refresh } = useShop();
  const supabase = supabaseBrowser();

  const activeServices = useMemo(() => services.filter((s) => s.is_active), [services]);

  const [count, setCount] = useState(1);
  const [rows, setRows] = useState<Row[]>([]);
  const [bulkServiceId, setBulkServiceId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [startTime, setStartTime] = useState(() => nowHHmm());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [picker, setPicker] = useState<number | null>(null);
  const [runnerFor, setRunnerFor] = useState<number | null>(null);
  const [runnerName, setRunnerName] = useState("");
  const [planSkipped, setPlanSkipped] = useState<
    Array<{ therapist_id: string; reason: string; detail: string }>
  >([]);

  const memberById = useMemo(
    () => new Map(rotation.members.map((m) => [m.therapist_id, m])),
    [rotation.members],
  );

  /** สร้างแถวใหม่ตามจำนวนลูกค้า โดยให้ระบบจ่ายคิวให้ */
  function buildRows(n: number, seed?: Prefill) {
    const plan = planFor(n);
    setPlanSkipped(
      plan.skipped.map((s) => ({ therapist_id: s.therapist_id, reason: s.reason, detail: s.detail })),
    );
    const svc = seed?.serviceId ?? bulkServiceId ?? null;
    const next: Row[] = plan.slots.map((slot, i) => {
      // ถ้าลูกค้าขอหมอนวดคนนี้เอง (มาจากรายชื่อรอคิว) ให้ล็อกคนแรกไว้
      const forced = i === 0 && seed?.therapistId ? seed.therapistId : null;
      const tid = forced ?? slot.member?.therapist_id ?? null;
      return {
        key: i,
        customerName: i === 0 ? (seed?.customerName ?? "") : "",
        serviceId: svc,
        therapistId: tid,
        needsRunner: !tid,
        isRunnerJob: tid ? Boolean(therapists.find((t) => t.id === tid)?.is_runner) : false,
        finalPrice: "",
        pay: "",
        durationMin: "",
        isRequest: i === 0 ? Boolean(seed?.isCustomerRequest) : false,
        reason: "",
      };
    });
    setRows(next);
  }

  useEffect(() => {
    if (!open) return;
    const n = Math.max(1, prefill?.customerCount ?? 1);
    setCount(n);
    setBulkServiceId(prefill?.serviceId ?? null);
    setNote(prefill?.note ?? "");
    setStartTime(nowHHmm());
    setErr(null);
    setPicker(null);
    setRunnerFor(null);
    setRunnerName("");
    buildRows(n, prefill);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function changeCount(n: number) {
    const next = Math.max(1, Math.min(12, n));
    setCount(next);
    buildRows(next);
  }

  function applyServiceToAll(sid: string) {
    setBulkServiceId(sid);
    setRows((rs) =>
      rs.map((r) => ({ ...r, serviceId: sid, finalPrice: "", pay: "", durationMin: "" })),
    );
  }

  function setRow(key: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function pickTherapist(key: number, therapistId: string) {
    const t = therapists.find((x) => x.id === therapistId);
    setRow(key, {
      therapistId,
      needsRunner: false,
      isRunnerJob: Boolean(t?.is_runner),
      pay: "",
    });
    setPicker(null);
  }

  /** เรียกหมอวิ่งเข้ามา แล้วจ่ายให้ช่องนี้ — ไม่ใส่ชื่อ = ระบบตั้งให้เป็น หมอวิ่ง N */
  async function callRunner(key: number, name: string) {
    setBusy(true);
    setErr(null);
    try {
      const { data, error } = await supabase.rpc("add_runner", { p_name: name.trim() || null });
      if (error) throw error;
      const t = data as { id: string; name: string } | null;
      if (!t?.id) throw new Error("เรียกหมอวิ่งไม่สำเร็จ");
      await refresh();
      setRow(key, { therapistId: t.id, needsRunner: false, isRunnerJob: true, pay: "" });
      setRunnerFor(null);
      setRunnerName("");
      onDone?.(`เรียกหมอวิ่ง ${t.name} เข้ามาแล้ว`, "ok");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "เรียกหมอวิ่งไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  /* ---------------- การคำนวณของแต่ละแถว ---------------- */

  function calc(r: Row) {
    const svc: Service | null = activeServices.find((s) => s.id === r.serviceId) ?? null;
    const th = r.therapistId ? therapists.find((t) => t.id === r.therapistId) ?? null : null;
    const orig = svc ? Number(svc.price) : 0;
    const defPay = svc ? defaultPayFor(svc, th) : 0;
    const dur = r.durationMin === "" ? (svc?.duration_min ?? 0) : Number(r.durationMin);
    const final = r.finalPrice === "" ? orig : Number(r.finalPrice);
    const pay = r.pay === "" ? defPay : Number(r.pay);
    return { svc, th, orig, defPay, dur, final, pay, discount: Math.max(0, orig - final) };
  }

  const totals = useMemo(() => {
    let orig = 0,
      final = 0,
      pay = 0;
    for (const r of rows) {
      const c = calc(r);
      orig += c.orig;
      final += c.final;
      pay += c.pay;
    }
    return { orig, final, pay, discount: Math.max(0, orig - final), shop: final - pay };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, activeServices, therapists]);

  const shortage = rows.filter((r) => !r.therapistId).length;
  const startIso = bangkokTimeToIso(workDate, startTime);
  const longestDur = rows.reduce((m, r) => Math.max(m, calc(r).dur), 0);
  const finishIso = new Date(new Date(startIso).getTime() + longestDur * 60000).toISOString();

  /* ---------------- บันทึก ---------------- */

  async function submit() {
    setErr(null);

    if (rows.some((r) => !r.serviceId)) return setErr("กรุณาเลือกบริการให้ลูกค้าทุกคน");
    if (shortage > 0)
      return setErr(
        `ยังมีลูกค้า ${shortage} คนที่ไม่มีหมอนวด — กด “เรียกหมอวิ่ง” หรือลดจำนวนลูกค้าลง แล้วใส่ที่เหลือเข้ารายชื่อรอคิว`,
      );

    const seen = new Set<string>();
    for (const r of rows) {
      if (r.therapistId && seen.has(r.therapistId))
        return setErr("หมอนวดคนเดียวรับลูกค้า 2 คนพร้อมกันไม่ได้ — กรุณาเปลี่ยนหมอนวด");
      if (r.therapistId) seen.add(r.therapistId);
    }

    for (const r of rows) {
      const m = memberById.get(r.therapistId!);
      if (m && !m.isAvailable)
        return setErr(
          `${m.name} ยังไม่ว่าง (เหลือ ${m.remainingMin ?? "-"} นาที) — กดปุ่ม “นวดเสร็จ” ของงานเดิมก่อน`,
        );
      if (calc(r).dur <= 0) return setErr("ระยะเวลาต้องมากกว่า 0 นาที");
    }

    // ถ้าไม่ตรงกับที่ระบบแนะนำ ต้องมีเหตุผล
    const suggested = new Set(
      planFor(rows.length)
        .slots.map((s) => s.member?.therapist_id)
        .filter(Boolean) as string[],
    );
    for (const r of rows) {
      const isOverride = !r.isRunnerJob && r.therapistId && !suggested.has(r.therapistId);
      if (isOverride && !r.isRequest && !r.reason.trim())
        return setErr("มีแถวที่เลือกหมอนวดเองแต่ยังไม่ได้ระบุเหตุผล");
    }

    setBusy(true);
    try {
      const assignments = rows.map((r) => {
        const c = calc(r);
        const isOverride = !r.isRunnerJob && !suggested.has(r.therapistId!);
        return {
          therapist_id: r.therapistId,
          service_id: r.serviceId,
          duration_min: c.dur,
          original_price: c.orig,
          final_price: c.final,
          default_pay: c.defPay,
          actual_pay: c.pay,
          customer_name: r.customerName.trim() || null,
          note: note.trim() || null,
          assignment_type: r.isRequest ? "customer_request" : isOverride ? "manual" : "queue",
          assignment_reason: r.reason.trim() || null,
          is_customer_request: r.isRequest,
          post_job_action: "rotation",
          is_runner_job: r.isRunnerJob,
        };
      });

      const { error } = await supabase.rpc("start_group", {
        p_assignments: assignments,
        p_start_at: startIso,
        p_skipped: planSkipped,
        p_shortage: 0,
      });
      if (error) throw error;

      if (prefill?.waitingId) {
        await supabase
          .from("waiting_customers")
          .update({ status: "seated" })
          .eq("id", prefill.waitingId);
      }

      await refresh();
      onDone?.(
        `เริ่มนวดแล้ว ${rows.length} คน · คาดว่าเสร็จ ${hhmm(finishIso)} · เก็บ ${baht(totals.final)}`,
        "ok",
      );
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "บันทึกไม่สำเร็จ";
      setErr(msg);
    } finally {
      setBusy(false);
    }
  }

  /* ---------------- หน้าจอ ---------------- */

  const availableCount = rotation.members.filter((m) => m.isAvailable).length;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="รับลูกค้าใหม่"
      subtitle={`${count} คน · เริ่ม ${startTime} · คาดว่าเสร็จ ${
        longestDur > 0 ? hhmm(finishIso) : "—"
      }`}
      wide
      footer={
        <div className="space-y-3">
          {err && (
            <p className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-700 ring-1 ring-red-200">
              {err}
            </p>
          )}
          <div className="flex items-center gap-3">
            <div className="hidden flex-1 sm:block">
              <p className="text-xs text-ink-400">เก็บ / ค่าแรง / ร้านได้</p>
              <p className="font-bold tabular-nums text-ink-800">
                {baht(totals.final)} <span className="text-ink-300">/</span>{" "}
                <span className="text-clay-500">{baht(totals.pay)}</span>{" "}
                <span className="text-ink-300">/</span>{" "}
                <span className="text-jade-700">{baht(totals.shop)}</span>
              </p>
            </div>
            <button className="btn-secondary" onClick={onClose}>
              ยกเลิก
            </button>
            <button
              className="btn-primary btn-lg flex-1 sm:flex-none"
              disabled={busy}
              onClick={() => void submit()}
            >
              {busy ? "กำลังบันทึก…" : `▶ เริ่มนวด ${rows.length} คน`}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-6">
        {/* 1. จำนวนลูกค้า */}
        <section>
          <p className="section-title mb-2">1. ลูกค้ามากี่คน</p>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <button
                className="btn-secondary h-[60px] w-[60px] shrink-0 !px-0 text-2xl"
                onClick={() => changeCount(count - 1)}
                aria-label="ลดจำนวนลูกค้า"
              >
                −
              </button>
              <input
                className="input w-24 text-center text-2xl font-bold"
                type="number"
                min={1}
                max={12}
                value={count}
                onChange={(e) => changeCount(Number(e.target.value || 1))}
              />
              <button
                className="btn-secondary h-[60px] w-[60px] shrink-0 !px-0 text-2xl"
                onClick={() => changeCount(count + 1)}
                aria-label="เพิ่มจำนวนลูกค้า"
              >
                +
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <button
                  key={n}
                  onClick={() => changeCount(n)}
                  className={`rounded-xl px-3.5 py-2 text-sm font-bold ${
                    count === n ? "bg-jade-600 text-white" : "bg-white ring-1 ring-sand-300"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            <p className="text-sm text-ink-400">
              หมอนวดว่างตอนนี้ <span className="font-bold text-emerald-600">{availableCount}</span> คน
            </p>
          </div>

          {shortage > 0 && (
            <div className="mt-3 rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-300">
              <p className="font-bold text-amber-900">
                ⚡ หมอนวดในร้านไม่พอ — ขาดอีก {shortage} คน
              </p>
              <p className="mt-0.5 text-sm text-amber-800">
                กดปุ่ม <strong>เรียกหมอวิ่ง</strong> ในแถวที่ยังว่าง หรือลดจำนวนลูกค้าลง
                แล้วใส่คนที่เหลือเข้ารายชื่อรอคิว
              </p>
            </div>
          )}

          {planSkipped.length > 0 && (
            <p className="mt-2 text-xs text-ink-400">
              ข้าม: {planSkipped.map((s) => rotation.members.find((m) => m.therapist_id === s.therapist_id)?.name ?? "—").join(", ")}{" "}
              (ยังไม่ว่าง — ไม่เสียคิวถาวร)
            </p>
          )}
        </section>

        {/* 2. บริการ */}
        <section>
          <p className="section-title mb-2">2. เลือกบริการ (ใช้กับลูกค้าทุกคน — แก้รายคนได้ด้านล่าง)</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {activeServices.map((s) => {
              const on = s.id === bulkServiceId;
              return (
                <button
                  key={s.id}
                  onClick={() => applyServiceToAll(s.id)}
                  className={`rounded-xl px-3 py-3 text-left transition ${
                    on
                      ? "bg-jade-600 text-white shadow-card"
                      : "bg-white text-ink-700 ring-1 ring-sand-300 hover:bg-sand-50"
                  }`}
                >
                  <span className="block text-sm font-semibold leading-tight">
                    {s.name_th || s.name_en}
                  </span>
                  <span className={`mt-1 block text-xs font-bold ${on ? "text-white" : "text-ink-600"}`}>
                    {baht(s.price)} · {s.duration_min} นาที
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* 3. รายคน */}
        <section>
          <p className="section-title mb-2">3. ลูกค้าและหมอนวด</p>
          <ul className="space-y-3">
            {rows.map((r) => {
              const c = calc(r);
              const m = r.therapistId ? memberById.get(r.therapistId) : null;
              const th = c.th;
              return (
                <li
                  key={r.key}
                  className={`rounded-2xl bg-white p-4 ring-1 ${
                    r.needsRunner ? "ring-2 ring-amber-400" : "ring-sand-300"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sand-100 text-sm font-bold text-ink-500">
                      {r.key + 1}
                    </span>

                    {/* หมอนวด */}
                    {r.therapistId ? (
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-base font-bold text-ink-800">{th?.name}</span>
                        {r.isRunnerJob && (
                          <span className="pill bg-amber-100 text-amber-800 ring-1 ring-amber-300">
                            ⚡ หมอวิ่ง
                          </span>
                        )}
                        {m && !r.isRunnerJob && (
                          <span className="text-xs text-ink-400">คิว #{m.position}</span>
                        )}
                        {m && !m.isAvailable && (
                          <StatusPill status={m.derived} remainingMin={m.remainingMin} size="sm" />
                        )}
                        <button
                          className="btn-ghost btn-sm text-jade-700"
                          onClick={() => setPicker(picker === r.key ? null : r.key)}
                        >
                          เปลี่ยน
                        </button>
                      </span>
                    ) : (
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="pill bg-amber-100 text-amber-900 ring-1 ring-amber-300">
                          ยังไม่มีหมอนวด
                        </span>
                        <button
                          className="btn-primary btn-sm !bg-amber-600 hover:!bg-amber-700"
                          disabled={busy}
                          onClick={() => void callRunner(r.key, "")}
                        >
                          ⚡ เรียกหมอวิ่ง
                        </button>
                        <button
                          className="btn-ghost btn-sm text-amber-700"
                          onClick={() => {
                            setRunnerName("");
                            setRunnerFor(r.key);
                          }}
                        >
                          ระบุชื่อเอง
                        </button>
                        <button
                          className="btn-ghost btn-sm text-jade-700"
                          onClick={() => setPicker(picker === r.key ? null : r.key)}
                        >
                          เลือกจากรายชื่อ
                        </button>
                      </span>
                    )}
                  </div>

                  {picker === r.key && (
                    <ul className="mt-3 max-h-60 space-y-1.5 overflow-y-auto rounded-xl bg-sand-50 p-2">
                      {rotation.members.map((mm) => {
                        const used = rows.some(
                          (x) => x.key !== r.key && x.therapistId === mm.therapist_id,
                        );
                        return (
                          <li key={mm.therapist_id}>
                            <button
                              disabled={used}
                              onClick={() => pickTherapist(r.key, mm.therapist_id)}
                              className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left ${
                                used
                                  ? "opacity-40"
                                  : mm.therapist_id === r.therapistId
                                    ? "bg-jade-600 text-white"
                                    : "bg-white ring-1 ring-sand-300 hover:bg-sand-100"
                              }`}
                            >
                              <span className="flex items-center gap-2">
                                <span className="text-xs font-bold text-ink-300">#{mm.position}</span>
                                <span className="text-sm font-semibold">{mm.name}</span>
                                {used && <span className="text-xs">(รับลูกค้าในกลุ่มนี้แล้ว)</span>}
                              </span>
                              <StatusPill status={mm.derived} remainingMin={mm.remainingMin} size="sm" />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <label className="label text-xs">ชื่อลูกค้า</label>
                      <input
                        className="input !min-h-[46px] text-sm"
                        placeholder="ไม่บังคับ"
                        value={r.customerName}
                        onChange={(e) => setRow(r.key, { customerName: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="label text-xs">บริการ</label>
                      <select
                        className="input !min-h-[46px] text-sm"
                        value={r.serviceId ?? ""}
                        onChange={(e) =>
                          setRow(r.key, {
                            serviceId: e.target.value || null,
                            finalPrice: "",
                            pay: "",
                            durationMin: "",
                          })
                        }
                      >
                        <option value="">— เลือก —</option>
                        {activeServices.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name_th || s.name_en} · {baht(s.price)} · {s.duration_min} นาที
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="label text-xs">ราคาขายจริง</label>
                      <input
                        className="input !min-h-[46px] font-bold"
                        type="number"
                        inputMode="decimal"
                        value={r.finalPrice === "" ? (c.orig || "") : r.finalPrice}
                        onChange={(e) => setRow(r.key, { finalPrice: e.target.value })}
                      />
                      {c.discount > 0 && (
                        <p className="mt-0.5 text-[11px] text-clay-500">ลด {baht(c.discount)}</p>
                      )}
                    </div>
                    <div>
                      <label className="label text-xs">ค่าแรงหมอนวด</label>
                      <input
                        className="input !min-h-[46px] font-bold"
                        type="number"
                        inputMode="decimal"
                        value={r.pay === "" ? (c.defPay || "") : r.pay}
                        onChange={(e) => setRow(r.key, { pay: e.target.value })}
                      />
                      <p className="mt-0.5 text-[11px] text-ink-400">
                        ร้านได้ {baht(c.final - c.pay)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-ink-600">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-jade-600"
                        checked={r.isRequest}
                        onChange={(e) => setRow(r.key, { isRequest: e.target.checked })}
                      />
                      ลูกค้าขอหมอนวดคนนี้เอง
                    </label>
                    <input
                      className="input !min-h-[40px] max-w-xs text-xs"
                      placeholder="เหตุผล (ถ้าเลือกไม่ตรงคิว)"
                      value={r.reason}
                      onChange={(e) => setRow(r.key, { reason: e.target.value })}
                      list={`reasons-${r.key}`}
                    />
                    <datalist id={`reasons-${r.key}`}>
                      {OVERRIDE_REASONS.map((x) => (
                        <option key={x} value={x} />
                      ))}
                    </datalist>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        {/* 4. เวลา + โน้ต */}
        <section>
          <p className="section-title mb-2">4. เวลาเริ่มนวด</p>
          <div className="flex flex-wrap items-end gap-3">
            <button className="btn-primary" onClick={() => setStartTime(nowHHmm())}>
              ⏱ เริ่มเดี๋ยวนี้
            </button>
            <div>
              <label className="label">หรือกำหนดเอง</label>
              <input
                className="input w-40"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
            <div className="rounded-xl bg-sand-100 px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-ink-400">คาดว่าเสร็จ</p>
              <p className="text-lg font-bold tabular-nums text-ink-800">
                {longestDur > 0 ? hhmm(finishIso) : "—"}
              </p>
            </div>
          </div>
          <div className="mt-4">
            <label className="label">โน้ตของกลุ่มนี้ (เช่น ขอนวดหนัก / มาเป็นครอบครัว)</label>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </section>

        {/* สรุป */}
        <section className="rounded-2xl bg-sand-100 p-4">
          <p className="section-title mb-2">สรุปทั้งกลุ่ม</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                ["ราคาตั้งรวม", baht(totals.orig), "text-ink-800"],
                ["ส่วนลดรวม", baht(totals.discount), "text-clay-500"],
                ["ค่าแรงรวม", baht(totals.pay), "text-clay-500"],
                ["ร้านได้สุทธิ", baht(totals.shop), "text-jade-700"],
              ] as const
            ).map(([l, v, cls]) => (
              <div key={l}>
                <p className="text-[11px] text-ink-400">{l}</p>
                <p className={`text-lg font-bold tabular-nums ${cls}`}>{v}</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* เรียกหมอวิ่ง */}
      <Modal
        open={runnerFor !== null}
        onClose={() => setRunnerFor(null)}
        title="⚡ เรียกหมอวิ่งเข้ามา"
        footer={
          <div className="flex gap-3">
            <button className="btn-secondary flex-1" onClick={() => setRunnerFor(null)}>
              ยกเลิก
            </button>
            <button
              className="btn-primary flex-1"
              disabled={busy}
              onClick={() => runnerFor !== null && void callRunner(runnerFor, runnerName)}
            >
              เรียกเข้ามา
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-ink-500">
            หมอวิ่งที่เรียกเข้ามาจะถูกลงคิวต่อท้ายของวันนี้อัตโนมัติ และนับยอด-ค่าแรงแยกให้เห็นชัด
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
              ไม่ต้องกรอกก็ได้ ระบบจะตั้งชื่อให้เอง
            </p>
          </div>
        </div>
      </Modal>
    </Drawer>
  );
}
