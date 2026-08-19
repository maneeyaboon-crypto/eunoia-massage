"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useShop } from "@/components/ShopProvider";
import { supabaseBrowser } from "@/lib/supabase/client";
import RangePicker, { makeRange, type Range } from "@/components/RangePicker";
import { Modal, StatCard, EmptyState } from "@/components/ui";
import { baht, hhmm, pct, shortDate } from "@/lib/format";
import { PAYMENT_LABEL } from "@/lib/status";
import type { TransactionRow } from "@/lib/types";

interface TherapistAgg {
  therapist_id: string;
  name: string;
  jobs: number;
  minutes: number;
  sales: number;
  pay: number;
  shop: number;
  discount: number;
  requests: number;
}

export default function FinancePage() {
  const { isOwner, todaySessions } = useShop();
  const supabase = supabaseBrowser();
  const [range, setRange] = useState<Range>(() => makeRange("today"));
  const [rows, setRows] = useState<TransactionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [drill, setDrill] = useState<TherapistAgg | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("v_transactions")
      .select("*")
      .gte("work_date", range.from)
      .lte("work_date", range.to)
      .order("start_at", { ascending: false });
    setRows((data ?? []) as TransactionRow[]);
    setLoading(false);
  }, [supabase, range.from, range.to]);

  useEffect(() => {
    void load();
  }, [load]);

  // Live-refresh today's figures as reception closes jobs.
  useEffect(() => {
    if (range.key === "today") void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todaySessions.length, range.key]);

  const valid = useMemo(() => rows.filter((r) => r.status === "finished"), [rows]);
  const voided = useMemo(() => rows.filter((r) => r.status === "voided"), [rows]);
  const active = useMemo(() => rows.filter((r) => r.status === "active"), [rows]);

  const t = useMemo(() => {
    const acc = {
      jobs: 0,
      customers: 0,
      original: 0,
      gross: 0,
      discount: 0,
      wages: 0,
      net: 0,
      cash: 0,
      qr: 0,
      card: 0,
      other: 0,
      unpaid: 0,
    };
    for (const r of valid) {
      acc.jobs++;
      acc.customers += Number(r.customer_count);
      acc.original += Number(r.original_price);
      acc.gross += Number(r.final_price);
      acc.discount += Number(r.discount);
      acc.wages += Number(r.actual_therapist_pay);
      acc.net += Number(r.shop_revenue);
      switch (r.payment_method) {
        case "cash":
          acc.cash += Number(r.final_price);
          break;
        case "qr":
          acc.qr += Number(r.final_price);
          break;
        case "card":
          acc.card += Number(r.final_price);
          break;
        case "other":
          acc.other += Number(r.final_price);
          break;
        default:
          acc.unpaid += Number(r.final_price);
      }
    }
    return acc;
  }, [valid]);

  const byTherapist = useMemo(() => {
    const map = new Map<string, TherapistAgg>();
    for (const r of valid) {
      const cur =
        map.get(r.therapist_id) ??
        {
          therapist_id: r.therapist_id,
          name: r.therapist_name,
          jobs: 0,
          minutes: 0,
          sales: 0,
          pay: 0,
          shop: 0,
          discount: 0,
          requests: 0,
        };
      cur.jobs++;
      cur.minutes += Number(r.duration_min);
      cur.sales += Number(r.final_price);
      cur.pay += Number(r.actual_therapist_pay);
      cur.shop += Number(r.shop_revenue);
      cur.discount += Number(r.discount);
      if (r.is_customer_request) cur.requests++;
      map.set(r.therapist_id, cur);
    }
    return [...map.values()].sort((a, b) => b.sales - a.sales);
  }, [valid]);

  const drillRows = useMemo(
    () => (drill ? valid.filter((r) => r.therapist_id === drill.therapist_id) : []),
    [drill, valid],
  );

  if (!isOwner) {
    return (
      <div className="card card-pad">
        <p className="font-semibold text-ink-800">เฉพาะเจ้าของร้านเท่านั้น</p>
        <p className="mt-1 text-sm text-ink-500">หน้าการเงินเปิดให้เฉพาะบัญชีเจ้าของร้าน</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-ink-800">การเงิน</h1>
        <p className="mt-1 text-sm text-ink-400">
          {shortDate(range.from)} — {shortDate(range.to)} · นับเฉพาะรายการที่ปิดงานแล้ว
          (Void ไม่รวมในยอด)
        </p>
      </div>

      <RangePicker range={range} onChange={setRange} />

      {/* Headline */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="ยอดขายจริง"
          value={baht(t.gross)}
          sub={`${t.jobs} งาน · ${t.customers} คน`}
          tone="accent"
        />
        <StatCard label="ยอดก่อนหักส่วนลด" value={baht(t.original)} />
        <StatCard
          label="ส่วนลดที่ให้ลูกค้า"
          value={baht(t.discount)}
          sub={`อัตราส่วนลด ${pct(t.discount, t.original)}`}
          tone="warn"
        />
        <StatCard label="ค่าแรงหมอนวด" value={baht(t.wages)} tone="bad" />
      </div>

      <div className="card card-pad bg-gradient-to-br from-jade-600 to-jade-700 !ring-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-jade-100">
          รายได้ร้านหลังหักค่าแรงหมอนวด
        </p>
        <p className="mt-1 text-4xl font-bold tabular-nums text-white">{baht(t.net)}</p>
        <p className="mt-1 text-sm text-jade-100">
          {baht(t.gross)} − {baht(t.wages)} · สัดส่วนร้าน {pct(t.net, t.gross)}
        </p>
      </div>

      {/* Payments */}
      <section className="card">
        <div className="border-b border-sand-200 px-4 py-3">
          <p className="section-title">แยกตามช่องทางรับเงิน</p>
        </div>
        <div className="grid grid-cols-2 divide-sand-100 sm:grid-cols-5 sm:divide-x">
          {(
            [
              ["เงินสด", t.cash],
              ["QR / โอน", t.qr],
              ["บัตร", t.card],
              ["อื่น ๆ", t.other],
              ["รวมทั้งหมด", t.cash + t.qr + t.card + t.other],
            ] as const
          ).map(([label, v], i) => (
            <div key={label} className={`px-4 py-4 ${i === 4 ? "bg-sand-50" : ""}`}>
              <p className="stat-label">{label}</p>
              <p className="mt-0.5 text-xl font-bold tabular-nums text-ink-800">{baht(v)}</p>
            </div>
          ))}
        </div>
        {(t.unpaid > 0 || active.length > 0) && (
          <p className="border-t border-sand-200 px-4 py-2.5 text-xs text-amber-700">
            {t.unpaid > 0 && <>มี {baht(t.unpaid)} ที่ยังไม่ระบุช่องทางชำระ · </>}
            {active.length > 0 && <>กำลังนวดอยู่ {active.length} รายการ (ยังไม่นับเป็นยอดขาย)</>}
          </p>
        )}
      </section>

      {/* Therapist earnings */}
      <section className="card overflow-x-auto">
        <div className="border-b border-sand-200 px-4 py-3">
          <p className="section-title">รายได้หมอนวด — กดชื่อเพื่อดูรายละเอียดแต่ละงาน</p>
        </div>
        {loading ? (
          <EmptyState icon="⏳" title="กำลังโหลด…" />
        ) : byTherapist.length === 0 ? (
          <EmptyState icon="📊" title="ไม่มีรายการในช่วงนี้" />
        ) : (
          <table className="w-full min-w-[760px]">
            <thead className="bg-sand-50">
              <tr>
                <th className="table-th">หมอนวด</th>
                <th className="table-th text-right">จำนวนงาน</th>
                <th className="table-th text-right">ชั่วโมง</th>
                <th className="table-th text-right">ยอดขายที่ทำได้</th>
                <th className="table-th text-right">ค่าแรงที่ได้</th>
                <th className="table-th text-right">ร้านได้</th>
                <th className="table-th text-right">ส่วนลด</th>
                <th className="table-th text-right">ลูกค้าขอ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sand-100">
              {byTherapist.map((r) => (
                <tr
                  key={r.therapist_id}
                  className="cursor-pointer hover:bg-sand-50"
                  onClick={() => setDrill(r)}
                >
                  <td className="table-td font-semibold text-jade-700 underline decoration-jade-200">
                    {r.name}
                  </td>
                  <td className="table-td text-right tabular-nums">{r.jobs}</td>
                  <td className="table-td text-right tabular-nums">
                    {(r.minutes / 60).toFixed(1)}
                  </td>
                  <td className="table-td text-right tabular-nums">{baht(r.sales)}</td>
                  <td className="table-td text-right tabular-nums text-clay-500">{baht(r.pay)}</td>
                  <td className="table-td text-right tabular-nums text-jade-700">{baht(r.shop)}</td>
                  <td className="table-td text-right tabular-nums">{baht(r.discount)}</td>
                  <td className="table-td text-right tabular-nums">{r.requests}</td>
                </tr>
              ))}
              <tr className="bg-sand-50 font-bold">
                <td className="table-td">รวม</td>
                <td className="table-td text-right tabular-nums">{t.jobs}</td>
                <td className="table-td text-right tabular-nums">
                  {(byTherapist.reduce((a, b) => a + b.minutes, 0) / 60).toFixed(1)}
                </td>
                <td className="table-td text-right tabular-nums">{baht(t.gross)}</td>
                <td className="table-td text-right tabular-nums">{baht(t.wages)}</td>
                <td className="table-td text-right tabular-nums text-jade-700">{baht(t.net)}</td>
                <td className="table-td text-right tabular-nums">{baht(t.discount)}</td>
                <td className="table-td"></td>
              </tr>
            </tbody>
          </table>
        )}
      </section>

      {voided.length > 0 && (
        <section className="card card-pad">
          <p className="section-title">รายการที่ถูกยกเลิก — ไม่รวมในยอด</p>
          <ul className="mt-2 space-y-1.5 text-sm">
            {voided.map((v) => (
              <li key={v.id} className="text-ink-500">
                <span className="font-mono text-xs text-ink-400">{v.transaction_id}</span>{" "}
                {v.therapist_name} · {baht(v.final_price)} —{" "}
                <span className="text-red-600">{v.void_reason}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Modal open={!!drill} onClose={() => setDrill(null)} title={`งานของ ${drill?.name ?? ""}`}>
        <ul className="space-y-2">
          {drillRows.map((r) => (
            <li key={r.id} className="rounded-xl bg-sand-50 px-4 py-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-ink-800">
                  {r.service_name_th || r.service_name_en}
                </span>
                <span className="font-bold tabular-nums text-ink-800">{baht(r.final_price)}</span>
              </div>
              <p className="mt-0.5 text-xs text-ink-400">
                {shortDate(r.work_date)} · {hhmm(r.start_at)}–{hhmm(r.finish_at)} · {r.duration_min}{" "}
                นาที · {r.customer_name || "ลูกค้าเดินเข้า"}
                {r.payment_method && ` · ${PAYMENT_LABEL[r.payment_method]}`}
              </p>
              <p className="mt-0.5 text-xs text-ink-500">
                ตั้ง {baht(r.original_price)} · ลด {baht(r.discount)} · ค่าแรง{" "}
                <span className="text-clay-500">{baht(r.actual_therapist_pay)}</span> · ร้านได้{" "}
                <span className="text-jade-700">{baht(r.shop_revenue)}</span>
              </p>
            </li>
          ))}
        </ul>
      </Modal>
    </div>
  );
}
