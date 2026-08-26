"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useShop } from "@/components/ShopProvider";
import { supabaseBrowser } from "@/lib/supabase/client";
import { EmptyState, Modal, StatCard, Toast } from "@/components/ui";
import { baht, bangkokToday, hhmm, pct, shortDate, thaiDateLong } from "@/lib/format";
import { PAYMENT_LABEL } from "@/lib/status";
import { pushDayToSheets } from "@/lib/sheets";
import type { DailyClosing, TherapistDailyStats, TransactionRow } from "@/lib/types";

export default function ReportsPage() {
  const { isOwner, therapists, todaySessions, settings } = useShop();
  const supabase = supabaseBrowser();

  const [date, setDate] = useState(() => bangkokToday());
  const [rows, setRows] = useState<TransactionRow[]>([]);
  const [stats, setStats] = useState<TherapistDailyStats[]>([]);
  const [closing, setClosing] = useState<DailyClosing | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [sheetBusy, setSheetBusy] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: "ok" | "err" } | null>(null);

  function flash(message: string, tone: "ok" | "err" = "ok") {
    setToast({ message, tone });
    setTimeout(() => setToast(null), 3200);
  }

  const load = useCallback(async () => {
    setLoading(true);
    const [tx, st, dc] = await Promise.all([
      supabase.from("v_transactions").select("*").eq("work_date", date).order("start_at"),
      supabase.from("v_therapist_daily_stats").select("*").eq("work_date", date),
      supabase.from("daily_closings").select("*").eq("work_date", date).maybeSingle(),
    ]);
    setRows((tx.data ?? []) as TransactionRow[]);
    setStats((st.data ?? []) as TherapistDailyStats[]);
    setClosing((dc.data as DailyClosing) ?? null);
    setLoading(false);
  }, [supabase, date]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (date === bangkokToday()) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todaySessions.length]);

  const finished = useMemo(() => rows.filter((r) => r.status === "finished"), [rows]);
  const stillActive = useMemo(() => rows.filter((r) => r.status === "active"), [rows]);

  const t = useMemo(() => {
    const a = {
      jobs: 0, customers: 0, original: 0, gross: 0, discount: 0,
      wages: 0, net: 0, cash: 0, qr: 0, card: 0, other: 0, unpaid: 0,
    };
    for (const r of finished) {
      a.jobs++;
      a.customers += Number(r.customer_count);
      a.original += Number(r.original_price);
      a.gross += Number(r.final_price);
      a.discount += Number(r.discount);
      a.wages += Number(r.actual_therapist_pay);
      a.net += Number(r.shop_revenue);
      switch (r.payment_method) {
        case "cash": a.cash += Number(r.final_price); break;
        case "qr": a.qr += Number(r.final_price); break;
        case "card": a.card += Number(r.final_price); break;
        case "other": a.other += Number(r.final_price); break;
        default: a.unpaid += Number(r.final_price);
      }
    }
    return a;
  }, [finished]);

  const statRows = useMemo(
    () =>
      stats
        .map((s) => ({ ...s, name: therapists.find((x) => x.id === s.therapist_id)?.name ?? "—" }))
        .sort((a, b) => b.jobs - a.jobs),
    [stats, therapists],
  );

  async function closeDay() {
    setBusy(true);
    try {
      const { error } = await supabase.rpc("close_day", {
        p_work_date: date,
        p_note: note.trim() || null,
      });
      if (error) throw error;
      setConfirmOpen(false);
      setNote("");
      await load();

      // ส่งรายละเอียดของวันเข้า Google Sheets ให้อัตโนมัติ (ถ้าเชื่อมต่อไว้)
      if (settings.sheets_webapp_url && settings.sheets_auto_on_close) {
        const r = await pushDayToSheets(date, "close_day");
        flash(
          r.ok
            ? `ปิดวันเรียบร้อย — เซฟลง Google Sheets แล้ว (${r.rows ?? 0} รายการ)`
            : `ปิดวันเรียบร้อย แต่ส่งเข้า Google Sheets ไม่สำเร็จ: ${r.error ?? ""} — กดปุ่ม "เซฟลง Google Sheets" อีกครั้งได้`,
          r.ok ? "ok" : "err",
        );
        return;
      }
      flash("ปิดวันเรียบร้อย — บันทึกยอดไว้ถาวรแล้ว");
    } catch (e) {
      flash(e instanceof Error ? e.message : "ปิดวันไม่สำเร็จ", "err");
    } finally {
      setBusy(false);
    }
  }

  async function sendToSheets() {
    setSheetBusy(true);
    const r = await pushDayToSheets(date, "manual");
    flash(
      r.ok
        ? `เซฟข้อมูลวันที่ ${date} ลง Google Sheets แล้ว (${r.rows ?? 0} รายการ)`
        : r.error ?? "ส่งเข้า Google Sheets ไม่สำเร็จ",
      r.ok ? "ok" : "err",
    );
    setSheetBusy(false);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink-800">รายงานสรุป &amp; ปิดวัน</h1>
          <p className="mt-1 text-sm text-ink-400">{thaiDateLong(new Date(date + "T12:00:00+07:00"))}</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label">เลือกวันที่</label>
            <input
              type="date"
              className="h-11 rounded-xl bg-white px-3 text-sm ring-1 ring-sand-300"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <button className="btn-secondary" onClick={() => window.print()}>
            🖨️ พิมพ์รายงาน
          </button>
          {settings.sheets_webapp_url && (
            <button
              className="btn-secondary"
              disabled={sheetBusy || loading}
              onClick={() => void sendToSheets()}
            >
              {sheetBusy ? "กำลังส่ง…" : "📗 เซฟลง Google Sheets"}
            </button>
          )}
          {isOwner && (
            <button
              className="btn-primary"
              disabled={loading}
              onClick={() => setConfirmOpen(true)}
            >
              {closing ? "ปิดวันอีกครั้ง (อัปเดตยอดที่บันทึกไว้)" : "🔒 ปิดวัน"}
            </button>
          )}
        </div>
      </div>

      {closing && (
        <p className="rounded-xl bg-jade-50 px-4 py-3 text-sm text-jade-800 ring-1 ring-jade-200">
          วันนี้ปิดยอดแล้วเมื่อ {shortDate(closing.closed_at)} {hhmm(closing.closed_at)} · บันทึกยอด
          {baht(closing.gross_sales)} / ร้านได้ {baht(closing.net_shop_revenue)} ไว้ถาวรแล้ว
          {closing.note && <> · โน้ต: {closing.note}</>}
        </p>
      )}

      {stillActive.length > 0 && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200">
          ยังมี {stillActive.length} รายการที่กำลังนวด — ต้องกดปุ่ม &quot;นวดเสร็จ&quot; ให้ครบก่อนปิดวัน
        </p>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="ลูกค้าทั้งหมด" value={t.customers} sub={`${t.jobs} งาน`} />
        <StatCard label="ยอดขายจริง" value={baht(t.gross)} tone="accent" />
        <StatCard
          label="ส่วนลด"
          value={baht(t.discount)}
          sub={`ก่อนลด ${baht(t.original)} · ${pct(t.discount, t.original)}`}
          tone="warn"
        />
        <StatCard label="ค่าแรงหมอนวด" value={baht(t.wages)} tone="bad" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="card card-pad bg-gradient-to-br from-jade-600 to-jade-700 !ring-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-jade-100">
            รายได้ร้านสุทธิ
          </p>
          <p className="mt-1 text-4xl font-bold tabular-nums text-white">{baht(t.net)}</p>
        </div>
        <div className="card">
          <div className="border-b border-sand-200 px-4 py-3">
            <p className="section-title">เงินที่รับมา</p>
          </div>
          <ul className="divide-y divide-sand-100">
            {(
              [
                ["เงินสด", t.cash],
                ["QR / โอน", t.qr],
                ["บัตร", t.card],
                ["อื่น ๆ", t.other],
              ] as const
            ).map(([k, v]) => (
              <li key={k} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span className="text-ink-500">{k}</span>
                <span className="font-bold tabular-nums text-ink-800">{baht(v)}</span>
              </li>
            ))}
            <li className="flex items-center justify-between bg-sand-50 px-4 py-3 text-sm font-bold">
              <span>รวมทั้งหมด</span>
              <span className="tabular-nums">{baht(t.cash + t.qr + t.card + t.other)}</span>
            </li>
            {t.unpaid > 0 && (
              <li className="flex items-center justify-between px-4 py-2.5 text-sm text-amber-700">
                <span>ยังไม่ระบุช่องทาง</span>
                <span className="font-bold tabular-nums">{baht(t.unpaid)}</span>
              </li>
            )}
          </ul>
        </div>
      </div>

      {/* Per-therapist */}
      <section className="card overflow-x-auto">
        <div className="border-b border-sand-200 px-4 py-3">
          <p className="section-title">
            สรุปรายหมอนวด + สถิติความยุติธรรมของคิว
          </p>
        </div>
        {loading ? (
          <EmptyState title="กำลังโหลด…" />
        ) : statRows.length === 0 ? (
          <EmptyState title="ไม่มีข้อมูลของวันนี้" />
        ) : (
          <table className="w-full min-w-[900px]">
            <thead className="bg-sand-50">
              <tr>
                <th className="table-th">หมอนวด</th>
                <th className="table-th text-right">รอบที่ได้</th>
                <th className="table-th text-right">ชั่วโมง</th>
                <th className="table-th text-right">ยอดขาย</th>
                <th className="table-th text-right">ค่าแรง</th>
                <th className="table-th text-right">ร้านได้</th>
                <th className="table-th text-right">ส่วนลดที่ให้</th>
                <th className="table-th text-right">ลูกค้าขอ</th>
                <th className="table-th text-right">งานหมอวิ่ง</th>
                <th className="table-th text-right">ถูกข้าม</th>
                <th className="table-th text-right">งานนอกร้าน</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sand-100">
              {statRows.map((s) => (
                <tr key={s.therapist_id}>
                  <td className="table-td font-semibold">
                    {s.name}
                    {therapists.find((t) => t.id === s.therapist_id)?.is_runner && (
                      <span className="ml-1 rounded px-1 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-200">
                        หมอวิ่ง
                      </span>
                    )}
                  </td>
                  <td className="table-td text-right tabular-nums">{s.jobs}</td>
                  <td className="table-td text-right tabular-nums">
                    {(Number(s.minutes_worked) / 60).toFixed(1)}
                  </td>
                  <td className="table-td text-right tabular-nums">{baht(s.sales_generated)}</td>
                  <td className="table-td text-right tabular-nums text-clay-500">
                    {baht(s.therapist_pay)}
                  </td>
                  <td className="table-td text-right tabular-nums text-jade-700">
                    {baht(s.shop_revenue)}
                  </td>
                  <td className="table-td text-right tabular-nums">{baht(s.discount_given)}</td>
                  <td className="table-td text-right tabular-nums">{s.customer_requests}</td>
                  <td className="table-td text-right tabular-nums text-amber-600">
                    {s.runner_jobs}
                  </td>
                  <td className="table-td text-right tabular-nums text-orange-600">{s.busy_skips}</td>
                  <td className="table-td text-right tabular-nums text-purple-600">
                    {s.outside_job_count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="border-t border-sand-200 px-4 py-2.5 text-[11px] text-ink-400">
          &quot;ถูกข้าม&quot; ใช้เพื่อดูความยุติธรรมเท่านั้น — ระบบไม่นำไปชดเชยคิวอัตโนมัติ
          คิวหลักยังเรียงตามลำดับที่มาลงชื่อเสมอ
        </p>
      </section>

      {/* All transactions of the day */}
      <section className="card overflow-x-auto">
        <div className="border-b border-sand-200 px-4 py-3">
          <p className="section-title">รายการทั้งวัน ({rows.length})</p>
        </div>
        {rows.length === 0 ? (
          <EmptyState title="ไม่มีรายการ" />
        ) : (
          <table className="w-full min-w-[820px]">
            <thead className="bg-sand-50">
              <tr>
                <th className="table-th">เวลา</th>
                <th className="table-th">รหัส</th>
                <th className="table-th">หมอนวด</th>
                <th className="table-th">บริการ</th>
                <th className="table-th text-right">ขายจริง</th>
                <th className="table-th text-right">ส่วนลด</th>
                <th className="table-th text-right">ค่าแรง</th>
                <th className="table-th">ชำระ</th>
                <th className="table-th">สถานะ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sand-100">
              {rows.map((r) => (
                <tr key={r.id} className={r.status === "voided" ? "text-ink-400 line-through" : ""}>
                  <td className="table-td tabular-nums">{hhmm(r.start_at)}</td>
                  <td className="table-td font-mono text-xs">{r.transaction_id}</td>
                  <td className="table-td">{r.therapist_name}</td>
                  <td className="table-td">{r.service_name_th || r.service_name_en}</td>
                  <td className="table-td text-right tabular-nums">{baht(r.final_price)}</td>
                  <td className="table-td text-right tabular-nums">{baht(r.discount)}</td>
                  <td className="table-td text-right tabular-nums">{baht(r.actual_therapist_pay)}</td>
                  <td className="table-td">
                    {r.payment_method ? PAYMENT_LABEL[r.payment_method] : "—"}
                  </td>
                  <td className="table-td text-xs">
                    {r.status === "finished" ? "ปิดแล้ว" : r.status === "active" ? "กำลังนวด" : "Void"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="ยืนยันปิดวัน"
        footer={
          <div className="flex gap-3">
            <button className="btn-secondary flex-1" onClick={() => setConfirmOpen(false)}>
              ยกเลิก
            </button>
            <button
              className="btn-primary flex-1"
              disabled={busy || stillActive.length > 0}
              onClick={() => void closeDay()}
            >
              ยืนยันปิดวัน
            </button>
          </div>
        }
      >
        <div className="space-y-3 text-sm">
          <p className="text-ink-500">
            ระบบจะบันทึกสำเนายอดของวันที่ {shortDate(date)} ไว้ถาวร — ยอดวันนี้จะไม่เปลี่ยน
            แม้ในอนาคตจะแก้ราคาบริการ
          </p>
          <ul className="space-y-1 rounded-xl bg-sand-50 px-4 py-3">
            <li className="flex justify-between">
              <span className="text-ink-400">ลูกค้า / งาน</span>
              <strong>{t.customers} / {t.jobs}</strong>
            </li>
            <li className="flex justify-between">
              <span className="text-ink-400">ยอดขายจริง</span>
              <strong>{baht(t.gross)}</strong>
            </li>
            <li className="flex justify-between">
              <span className="text-ink-400">ส่วนลด</span>
              <strong>{baht(t.discount)}</strong>
            </li>
            <li className="flex justify-between">
              <span className="text-ink-400">ค่าแรงหมอนวด</span>
              <strong>{baht(t.wages)}</strong>
            </li>
            <li className="flex justify-between border-t border-sand-200 pt-1">
              <span className="text-ink-400">รายได้ร้านสุทธิ</span>
              <strong className="text-jade-700">{baht(t.net)}</strong>
            </li>
          </ul>
          {stillActive.length > 0 && (
            <p className="rounded-xl bg-red-50 px-4 py-3 text-red-700 ring-1 ring-red-200">
              ยังมีงานที่กำลังนวด {stillActive.length} รายการ — ปิดวันไม่ได้
            </p>
          )}
          <div>
            <label className="label">โน้ตปิดวัน (ไม่บังคับ)</label>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
      </Modal>

      {toast && <Toast message={toast.message} tone={toast.tone} />}
    </div>
  );
}
