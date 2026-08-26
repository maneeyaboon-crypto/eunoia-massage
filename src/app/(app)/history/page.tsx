"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useShop } from "@/components/ShopProvider";
import { supabaseBrowser } from "@/lib/supabase/client";
import RangePicker, { makeRange, type Range } from "@/components/RangePicker";
import { Modal, EmptyState, Toast } from "@/components/ui";
import { PAYMENT_LABEL, PAYMENT_METHODS } from "@/lib/status";
import { baht, bangkokToday, bangkokTimeToIso, hhmm, shortDate } from "@/lib/format";
import type { PaymentMethod, TransactionRow } from "@/lib/types";

export default function HistoryPage() {
  const { isOwner, therapists, services, refresh } = useShop();
  const supabase = supabaseBrowser();
  const today = bangkokToday();

  const [range, setRange] = useState<Range>(() => makeRange("today"));
  const [rows, setRows] = useState<TransactionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [therapistId, setTherapistId] = useState("");
  const [serviceName, setServiceName] = useState("");
  const [method, setMethod] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [onlyDiscount, setOnlyDiscount] = useState(false);
  const [q, setQ] = useState("");

  const [detail, setDetail] = useState<TransactionRow | null>(null);
  const [voiding, setVoiding] = useState<TransactionRow | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [editing, setEditing] = useState<TransactionRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: "ok" | "err" } | null>(null);

  const [editFinal, setEditFinal] = useState("");
  const [editPay, setEditPay] = useState("");
  const [editOriginal, setEditOriginal] = useState("");
  const [editMethod, setEditMethod] = useState<PaymentMethod>("cash");
  const [editServiceId, setEditServiceId] = useState("");
  const [editTherapistId, setEditTherapistId] = useState("");
  const [editStart, setEditStart] = useState("");
  const [editDuration, setEditDuration] = useState("");
  const [editCustomer, setEditCustomer] = useState("");
  const [editReason, setEditReason] = useState("");

  function flash(message: string, tone: "ok" | "err" = "ok") {
    setToast({ message, tone });
    setTimeout(() => setToast(null), 2800);
  }

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from("v_transactions")
      .select("*")
      .gte("work_date", range.from)
      .lte("work_date", range.to)
      .order("start_at", { ascending: false })
      .limit(1000);

    if (therapistId) query = query.eq("therapist_id", therapistId);
    if (serviceName) query = query.eq("service_name_en", serviceName);
    if (method) query = query.eq("payment_method", method);
    if (minPrice) query = query.gte("final_price", Number(minPrice));
    if (maxPrice) query = query.lte("final_price", Number(maxPrice));
    if (onlyDiscount) query = query.gt("discount", 0);

    const { data, error } = await query;
    if (error) flash(error.message, "err");
    setRows((data ?? []) as TransactionRow[]);
    setLoading(false);
  }, [supabase, range.from, range.to, therapistId, serviceName, method, minPrice, maxPrice, onlyDiscount]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!q.trim()) return rows;
    const needle = q.trim().toLowerCase();
    return rows.filter((r) =>
      [r.transaction_id, r.customer_name, r.therapist_name, r.service_name_en, r.service_name_th, r.note]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle)),
    );
  }, [rows, q]);

  const sums = useMemo(() => {
    const s = { gross: 0, discount: 0, pay: 0, shop: 0, jobs: 0 };
    for (const r of filtered) {
      if (r.status !== "finished") continue;
      s.jobs++;
      s.gross += Number(r.final_price);
      s.discount += Number(r.discount);
      s.pay += Number(r.actual_therapist_pay);
      s.shop += Number(r.shop_revenue);
    }
    return s;
  }, [filtered]);

  function openEdit(r: TransactionRow) {
    setEditFinal(String(r.final_price));
    setEditPay(String(r.actual_therapist_pay));
    setEditOriginal(String(r.original_price));
    setEditMethod(r.payment_method ?? "cash");
    setEditServiceId(r.service_id ?? "");
    setEditTherapistId(r.therapist_id);
    setEditStart(hhmm(r.start_at));
    setEditDuration(String(r.duration_min));
    setEditCustomer(r.customer_name ?? "");
    setEditReason("");
    setEditing(r);
  }

  /** เลือกบริการใหม่ → เติมราคาและเวลาของบริการนั้นให้อัตโนมัติ */
  function pickEditService(id: string) {
    setEditServiceId(id);
    const svc = services.find((x) => x.id === id);
    if (svc) {
      setEditOriginal(String(svc.price));
      setEditFinal(String(svc.price));
      setEditPay(String(svc.default_therapist_pay));
      setEditDuration(String(svc.duration_min));
    }
  }

  async function saveEdit() {
    if (!editing) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc("update_session", {
        p_session_id: editing.id,
        p_service_id: editServiceId || null,
        p_therapist_id: editTherapistId || null,
        p_start_at: editStart ? bangkokTimeToIso(editing.work_date, editStart) : null,
        p_duration_min: Number(editDuration) || null,
        p_customer_name: editCustomer.trim() || null,
        p_final_price: Number(editFinal || 0),
        p_actual_pay: Number(editPay || 0),
        p_original_price: Number(editOriginal || 0),
        p_payment_method: editMethod,
        p_note: null,
        p_reason: editReason.trim() || null,
      });
      if (error) throw error;
      setEditing(null);
      await load();
      await refresh();
      flash("แก้ไขรายการแล้ว — บันทึกประวัติการแก้ไขไว้แล้ว");
    } catch (e) {
      flash(e instanceof Error ? e.message : "แก้ไขไม่สำเร็จ", "err");
    } finally {
      setBusy(false);
    }
  }

  async function doVoid() {
    if (!voiding) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc("void_session", {
        p_session_id: voiding.id,
        p_reason: voidReason,
      });
      if (error) throw error;
      setVoiding(null);
      setVoidReason("");
      await load();
      await refresh();
      flash("ยกเลิกรายการแล้ว (ยังอยู่ในประวัติและบันทึกการแก้ไข)");
    } catch (e) {
      flash(e instanceof Error ? e.message : "ยกเลิกไม่สำเร็จ", "err");
    } finally {
      setBusy(false);
    }
  }

  function exportCsv() {
    const head = [
      "รหัสรายการ", "วันที่", "เริ่ม", "เสร็จ", "หมอนวด", "บริการ", "ลูกค้า",
      "ราคาตั้ง", "ราคาขายจริง", "ส่วนลด", "ค่าแรงหมอนวด", "ร้านได้สุทธิ",
      "ช่องทางชำระ", "สถานะ", "ผู้บันทึก",
    ];
    const lines = filtered.map((r) =>
      [
        r.transaction_id, r.work_date, hhmm(r.start_at), hhmm(r.finish_at), r.therapist_name,
        r.service_name_en, r.customer_name ?? "", r.original_price, r.final_price, r.discount,
        r.actual_therapist_pay, r.shop_revenue, r.payment_method ?? "", r.status,
        r.created_by_email ?? "",
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(","),
    );
    const blob = new Blob(["﻿" + [head.join(","), ...lines].join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `eunoia-transactions-${range.from}_${range.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink-800">ประวัติรายการ</h1>
          <p className="mt-1 text-sm text-ink-400">
            {filtered.length} รายการ · ปิดงานแล้ว {sums.jobs} · ยอด {baht(sums.gross)} · ส่วนลด{" "}
            {baht(sums.discount)} · ค่าแรง {baht(sums.pay)} · ร้านได้ {baht(sums.shop)}
          </p>
        </div>
        <button className="btn-secondary" onClick={exportCsv}>
          <span className="mr-1.5" aria-hidden>⬇️</span>บันทึกเป็นไฟล์ Excel (CSV)
        </button>
      </div>

      <RangePicker range={range} onChange={setRange} />

      <section className="card card-pad">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="label">ค้นหา</label>
            <input
              className="input"
              placeholder="ชื่อลูกค้า / รหัสรายการ / โน้ต"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div>
            <label className="label">หมอนวด</label>
            <select className="input" value={therapistId} onChange={(e) => setTherapistId(e.target.value)}>
              <option value="">ทั้งหมด</option>
              {therapists.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">บริการ</label>
            <select className="input" value={serviceName} onChange={(e) => setServiceName(e.target.value)}>
              <option value="">ทั้งหมด</option>
              {services.map((s) => (
                <option key={s.id} value={s.name_en}>
                  {s.name_th || s.name_en}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">ช่องทางชำระ</label>
            <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="">ทั้งหมด</option>
              {PAYMENT_METHODS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">ราคาต่ำสุด</label>
            <input
              className="input"
              type="number"
              value={minPrice}
              onChange={(e) => setMinPrice(e.target.value)}
            />
          </div>
          <div>
            <label className="label">ราคาสูงสุด</label>
            <input
              className="input"
              type="number"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
            />
          </div>
          <label className="flex cursor-pointer items-center gap-3 self-end rounded-xl bg-sand-50 px-4 py-3 ring-1 ring-sand-300">
            <input
              type="checkbox"
              className="h-5 w-5 accent-jade-600"
              checked={onlyDiscount}
              onChange={(e) => setOnlyDiscount(e.target.checked)}
            />
            <span className="text-sm font-medium">เฉพาะที่มีส่วนลด</span>
          </label>
          <button
            className="btn-ghost self-end"
            onClick={() => {
              setQ("");
              setTherapistId("");
              setServiceName("");
              setMethod("");
              setMinPrice("");
              setMaxPrice("");
              setOnlyDiscount(false);
            }}
          >
            ล้างตัวกรอง
          </button>
        </div>
      </section>

      <section className="card overflow-x-auto">
        {loading ? (
          <EmptyState title="กำลังโหลด…" />
        ) : filtered.length === 0 ? (
          <EmptyState title="ไม่มีรายการตามเงื่อนไข" />
        ) : (
          <table className="w-full min-w-[1080px]">
            <thead className="border-b border-sand-200 bg-sand-50">
              <tr>
                <th className="table-th">รหัสรายการ</th>
                <th className="table-th">วันที่ / เวลา</th>
                <th className="table-th">หมอนวด</th>
                <th className="table-th">บริการ</th>
                <th className="table-th text-right">ราคาตั้ง</th>
                <th className="table-th text-right">ขายจริง</th>
                <th className="table-th text-right">ส่วนลด</th>
                <th className="table-th text-right">ค่าแรง</th>
                <th className="table-th text-right">ร้านได้</th>
                <th className="table-th">ชำระ</th>
                <th className="table-th">ผู้บันทึก</th>
                <th className="table-th"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sand-100">
              {filtered.map((r) => (
                <tr
                  key={r.id}
                  className={
                    r.status === "voided"
                      ? "bg-red-50/40 text-ink-400 line-through"
                      : r.status === "active"
                        ? "bg-amber-50/40"
                        : ""
                  }
                >
                  <td className="table-td">
                    <button
                      className="font-mono text-xs font-semibold text-jade-700"
                      onClick={() => setDetail(r)}
                    >
                      {r.transaction_id}
                    </button>
                    {r.status === "active" && (
                      <span className="ml-1 text-[10px] font-bold text-amber-600">กำลังนวด</span>
                    )}
                    {r.status === "voided" && (
                      <span className="ml-1 text-[10px] font-bold text-red-600">ยกเลิกแล้ว</span>
                    )}
                    {r.is_backdated && (
                      <span className="ml-1 rounded px-1 text-[10px] font-bold text-sky-700 ring-1 ring-sky-200">
                        ย้อนหลัง
                      </span>
                    )}
                  </td>
                  <td className="table-td">
                    {shortDate(r.work_date)}
                    <span className="ml-1 text-ink-400">
                      {hhmm(r.start_at)}–{r.status === "active" ? "…" : hhmm(r.finish_at)}
                    </span>
                  </td>
                  <td className="table-td font-semibold">{r.therapist_name}</td>
                  <td className="table-td">
                    {r.service_name_th || r.service_name_en}
                    <span className="ml-1 text-xs text-ink-400">{r.duration_min}น.</span>
                    {r.is_customer_request && (
                    <span className="ml-1 rounded px-1 py-0.5 text-[10px] font-semibold text-jade-700 ring-1 ring-jade-200">
                      ลูกค้าขอ
                    </span>
                  )}
                  </td>
                  <td className="table-td text-right tabular-nums">{baht(r.original_price)}</td>
                  <td className="table-td text-right font-semibold tabular-nums">
                    {baht(r.final_price)}
                  </td>
                  <td className="table-td text-right tabular-nums text-clay-500">
                    {Number(r.discount) > 0 ? baht(r.discount) : "—"}
                  </td>
                  <td className="table-td text-right tabular-nums">{baht(r.actual_therapist_pay)}</td>
                  <td className="table-td text-right tabular-nums text-jade-700">
                    {baht(r.shop_revenue)}
                  </td>
                  <td className="table-td">
                    {r.payment_method ? PAYMENT_LABEL[r.payment_method] : "—"}
                  </td>
                  <td className="table-td text-xs text-ink-400">
                    {r.created_by_name || r.created_by_email || "—"}
                  </td>
                  <td className="table-td">
                    {r.status !== "voided" && (
                      <div className="flex justify-end gap-1">
                        {(isOwner || r.status === "active" || r.work_date === today) && (
                          <button className="btn-ghost btn-sm" onClick={() => openEdit(r)}>
                            แก้ไข
                          </button>
                        )}
                        {(isOwner || r.work_date === today) && (
                          <button
                            className="btn-ghost btn-sm text-red-500"
                            onClick={() => {
                              setVoidReason("");
                              setVoiding(r);
                            }}
                          >
                            ยกเลิก
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Detail */}
      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={`รายละเอียด ${detail?.transaction_id ?? ""}`}
      >
        {detail && (
          <dl className="space-y-2 text-sm">
            {(
              [
                ["รหัสรายการ", detail.transaction_id],
                ["วันที่", shortDate(detail.work_date)],
                ["เวลาเริ่ม", hhmm(detail.start_at)],
                ["เวลาเสร็จ", detail.status === "active" ? "กำลังนวด" : hhmm(detail.finish_at)],
                ["หมอนวด", detail.therapist_name],
                [
                  "บริการ",
                  `${detail.service_name_th || detail.service_name_en} (${detail.duration_min} นาที)`,
                ],
                ["ลูกค้า", `${detail.customer_name || "ลูกค้าเดินเข้า"} · ${detail.customer_count} คน`],
                ["ราคาตั้ง", baht(detail.original_price)],
                ["ราคาขายจริง", baht(detail.final_price)],
                ["ส่วนลด", baht(detail.discount)],
                ["ค่าแรงหมอนวด (ค่าเริ่มต้น)", baht(detail.default_therapist_pay)],
                ["ค่าแรงหมอนวด (จ่ายจริง)", baht(detail.actual_therapist_pay)],
                ["ร้านได้สุทธิ", baht(detail.shop_revenue)],
                ["ช่องทางชำระ", detail.payment_method ? PAYMENT_LABEL[detail.payment_method] : "—"],
                [
                  "การจ่ายคิว",
                  detail.assignment_type === "queue"
                    ? "ตามคิวปกติ"
                    : detail.assignment_type === "customer_request"
                      ? "ลูกค้าขอหมอนวดคนนี้"
                      : "ผู้ใช้เลือกเอง",
                ],
                ["โน้ต", detail.note || "—"],
                ["บันทึกโดย", detail.created_by_name || detail.created_by_email || "—"],
                ["ปิดงานโดย", detail.finished_by_email || "—"],
                ["สถานะ", detail.status === "finished" ? "ปิดงานแล้ว" : detail.status === "active" ? "กำลังนวด" : "ยกเลิกแล้ว"],
                ["เหตุผลที่ยกเลิก", detail.void_reason || "—"],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 border-b border-sand-100 pb-1.5">
                <dt className="text-ink-400">{k}</dt>
                <dd className="text-right font-medium text-ink-700">{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </Modal>

      {/* Edit */}
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={`แก้ไขรายการ ${editing?.transaction_id ?? ""}`}
        footer={
          <div className="flex gap-3">
            <button className="btn-secondary flex-1" onClick={() => setEditing(null)}>
              ยกเลิก
            </button>
            <button className="btn-primary flex-1" disabled={busy} onClick={() => void saveEdit()}>
              บันทึก
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <p className="rounded-xl bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-800 ring-1 ring-amber-200">
            แก้ได้ทุกช่องเผื่อลงผิด — บริการ หมอนวด เวลา ราคา ค่าแรง
            ทุกการแก้ไขถูกบันทึกไว้พร้อมค่าก่อน-หลังและชื่อผู้แก้ ลบทิ้งไม่ได้
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">บริการ</label>
              <select
                className="input"
                value={editServiceId}
                onChange={(e) => pickEditService(e.target.value)}
              >
                <option value="">— ไม่เปลี่ยน —</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name_th || s.name_en} · {baht(s.price)} · {s.duration_min} นาที
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">หมอนวด</label>
              <select
                className="input"
                value={editTherapistId}
                onChange={(e) => setEditTherapistId(e.target.value)}
              >
                {therapists.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.is_runner ? " (หมอวิ่ง)" : ""}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-ink-400">
                เปลี่ยนได้เฉพาะคนที่ลงคิวในวันนั้น และต้องไม่ติดงานอื่นอยู่
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="label">เวลาเริ่ม</label>
              <input
                className="input"
                type="time"
                value={editStart}
                onChange={(e) => setEditStart(e.target.value)}
              />
            </div>
            <div>
              <label className="label">ระยะเวลา (นาที)</label>
              <input
                className="input"
                type="number"
                value={editDuration}
                onChange={(e) => setEditDuration(e.target.value)}
              />
            </div>
            <div>
              <label className="label">ชื่อลูกค้า</label>
              <input
                className="input"
                value={editCustomer}
                onChange={(e) => setEditCustomer(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="label">ราคาตั้ง (฿)</label>
              <input
                className="input"
                type="number"
                value={editOriginal}
                onChange={(e) => setEditOriginal(e.target.value)}
              />
            </div>
            <div>
              <label className="label">ราคาขายจริง (฿)</label>
              <input
                className="input font-bold"
                type="number"
                value={editFinal}
                onChange={(e) => setEditFinal(e.target.value)}
              />
              <p className="mt-1 text-[11px] text-clay-500">
                ส่วนลด {baht(Math.max(0, Number(editOriginal || 0) - Number(editFinal || 0)))}
              </p>
            </div>
            <div>
              <label className="label">ค่าแรงหมอนวด (฿)</label>
              <input
                className="input font-bold"
                type="number"
                value={editPay}
                onChange={(e) => setEditPay(e.target.value)}
              />
              <p className="mt-1 text-[11px] text-jade-700">
                ร้านได้ {baht(Number(editFinal || 0) - Number(editPay || 0))}
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">ช่องทางชำระ</label>
              <select
                className="input"
                value={editMethod}
                onChange={(e) => setEditMethod(e.target.value as PaymentMethod)}
              >
                {PAYMENT_METHODS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">เหตุผลที่แก้ (ไม่บังคับ)</label>
              <input
                className="input"
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
                placeholder="เช่น คีย์ผิดบริการ / สลับหมอนวด"
              />
            </div>
          </div>
        </div>
      </Modal>

      {/* Void */}
      <Modal
        open={!!voiding}
        onClose={() => setVoiding(null)}
        title={`ยกเลิกรายการ ${voiding?.transaction_id ?? ""}`}
        footer={
          <div className="flex gap-3">
            <button className="btn-secondary flex-1" onClick={() => setVoiding(null)}>
              ไม่ยกเลิก
            </button>
            <button
              className="btn-danger flex-1"
              disabled={busy || !voidReason.trim()}
              onClick={() => void doVoid()}
            >
              ยืนยันยกเลิก
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-ink-500">
            รายการทางการเงินจะไม่ถูกลบออกจากฐานข้อมูล — จะถูกทำเครื่องหมายว่ายกเลิก
            ไม่นับในยอดรายได้ แต่ยังอยู่ในประวัติและบันทึกการแก้ไข
          </p>
          <div>
            <label className="label">เหตุผล (จำเป็น) *</label>
            <textarea
              className="input py-3"
              rows={3}
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="เช่น คีย์ผิดบริการ / ลูกค้ายกเลิก"
            />
          </div>
        </div>
      </Modal>

      {toast && <Toast message={toast.message} tone={toast.tone} />}
    </div>
  );
}
