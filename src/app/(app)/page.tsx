"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useShop } from "@/components/ShopProvider";
import ActiveSessionCard from "@/components/ActiveSessionCard";
import NewCustomerDrawer, { type Prefill } from "@/components/NewCustomerDrawer";
import { FinishDialog, ExtendDialog } from "@/components/SessionDialogs";
import WaitingPanel from "@/components/WaitingPanel";
import ActivityPanel from "@/components/ActivityPanel";
import { StatCard, StatusPill, EmptyState, Toast } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import { PAYMENT_METHODS } from "@/lib/status";
import { baht, hhmm } from "@/lib/format";
import { dayTotals, totalsByTherapist, totalsFor } from "@/lib/derive";
import type { MassageSession } from "@/lib/types";

export default function DashboardPage() {
  const { queue, rotation, activeSessions, todaySessions, unpaid, settings, loading, dayClosed, refresh } =
    useShop();
  const supabase = supabaseBrowser();
  const runnerCount = queue.filter((q) => q.entry_type === "runner").length;

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [prefill, setPrefill] = useState<Prefill | undefined>(undefined);
  const [finishing, setFinishing] = useState<MassageSession | null>(null);
  const [extending, setExtending] = useState<MassageSession | null>(null);
  const [extendPreset, setExtendPreset] = useState<number | undefined>(undefined);
  const [toast, setToast] = useState<{ message: string; tone: "ok" | "err" } | null>(null);
  const [settling, setSettling] = useState(false);

  /** เก็บเงินงานที่ระบบปิดให้อัตโนมัติ — กดช่องทางเดียวจบ */
  async function settle(sessionId: string, methodValue: string) {
    setSettling(true);
    try {
      const { error } = await supabase.rpc("settle_session", {
        p_session_id: sessionId,
        p_payment_method: methodValue,
      });
      if (error) throw error;
      await refresh();
      flash("เก็บเงินเรียบร้อย", "ok");
    } catch (e) {
      flash(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ", "err");
    } finally {
      setSettling(false);
    }
  }

  const totals = useMemo(() => dayTotals(todaySessions), [todaySessions]);
  const perTherapist = useMemo(() => totalsByTherapist(todaySessions), [todaySessions]);

  const counts = useMemo(() => {
    const c = { available: 0, busy: 0, break: 0, outside: 0, off: 0, finishing: 0 };
    for (const m of rotation.members) {
      if (m.isAvailable) c.available++;
      else if (m.activeSession) {
        c.busy++;
        if (m.derived === "finishing_soon" || m.derived === "urgent" || m.derived === "expected_finished")
          c.finishing++;
      } else if (m.derived === "break") c.break++;
      else if (m.derived === "outside_job") c.outside++;
      else if (m.derived === "off_duty") c.off++;
    }
    return c;
  }, [rotation.members]);

  function flash(message: string, tone: "ok" | "err") {
    setToast({ message, tone });
    setTimeout(() => setToast(null), 3000);
  }

  function openNew(p?: Prefill) {
    setPrefill(p);
    setDrawerOpen(true);
  }

  const sortedActive = useMemo(
    () =>
      [...activeSessions].sort(
        (a, b) =>
          new Date(a.expected_finish_at).getTime() - new Date(b.expected_finish_at).getTime(),
      ),
    [activeSessions],
  );

  return (
    <div className="space-y-4">
      {/* ---------------- TOP: headline numbers ---------------- */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard
          label="ยอดขายวันนี้"
          value={baht(totals.grossSales)}
          sub={`${totals.jobs} รายการปิดแล้ว`}
          tone="accent"
        />
        <StatCard
          label="ค่าแรงหมอนวด"
          value={baht(totals.wages)}
          sub={`ส่วนลด ${baht(totals.discount)}`}
        />
        <StatCard label="ร้านได้สุทธิ" value={baht(totals.netRevenue)} tone="good" />
        <StatCard
          label="ลูกค้ากำลังใช้บริการ"
          value={totals.activeCustomers}
          sub={`${totals.activeCount} เตียง`}
          tone="warn"
        />
        <StatCard
          label="หมอนวดว่าง"
          value={counts.available}
          sub={
            runnerCount > 0
              ? `มาทำงาน ${queue.length} คน · หมอวิ่ง ${runnerCount}`
              : `มาทำงาน ${queue.length} คน`
          }
          tone="good"
        />
        <StatCard
          label="กำลังนวด"
          value={counts.busy}
          sub={`พัก ${counts.break} · งานนอก ${counts.outside} · เลิก ${counts.off}`}
          tone="bad"
        />
      </div>

      {/* ---------------- BIG ACTION ---------------- */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <button className="btn-primary btn-lg flex-1 !text-lg" onClick={() => openNew()}>
          + รับลูกค้า
        </button>
        {rotation.next ? (
          <div className="flex items-center gap-3 rounded-2xl bg-white px-5 py-3 shadow-card ring-1 ring-jade-200">
            <span className="text-[11px] font-semibold uppercase tracking-widest text-ink-400">
              คิวถัดไป
            </span>
            <span className="text-xl font-bold text-ink-800">🥇 {rotation.next.name}</span>
            <span className="pill bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">ว่าง</span>
            <button className="btn-primary btn-sm" onClick={() => openNew()}>
              จ่ายงานให้
            </button>
          </div>
        ) : (
          <div className="rounded-2xl bg-amber-50 px-5 py-3 text-sm font-semibold text-amber-800 ring-1 ring-amber-200">
            ไม่มีหมอนวดว่าง
            {rotation.upcoming[0] &&
              ` — ${rotation.upcoming[0].name} จะว่างในอีกประมาณ ${Math.max(0, rotation.upcoming[0].remainingMin ?? 0)} นาที`}
          </div>
        )}
      </div>

      {settings.auto_finish_enabled && (
        <p className="rounded-xl bg-jade-50 px-4 py-2.5 text-xs text-jade-800 ring-1 ring-jade-200">
          ⏱ โหมดปิดงานอัตโนมัติ <strong>เปิดอยู่</strong> — ครบเวลาแล้วระบบจะปิดงานให้เอง
          {settings.auto_finish_grace_min > 0
            ? ` (ผ่อนผัน ${settings.auto_finish_grace_min} นาที)`
            : ""}{" "}
          หมอนวดกลับเป็นว่างทันที และงานนั้นจะไปรอที่กล่อง &quot;รอเก็บเงิน&quot;
        </p>
      )}

      {dayClosed && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200">
          วันนี้ปิดยอดแล้ว — ถ้ามีรายการเพิ่ม ต้องไปกดปิดวันใหม่ที่หน้ารายงาน
        </p>
      )}

      {/* ---------------- 3-COLUMN BODY ---------------- */}
      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)_320px]">
        {/* LEFT — today's queue */}
        <section className="card">
          <div className="flex items-center justify-between border-b border-sand-200 px-4 py-3">
            <p className="section-title">คิววันนี้</p>
            <Link href="/queue" className="text-xs font-semibold text-jade-700">
              จัดการ →
            </Link>
          </div>
          {queue.length === 0 ? (
            <EmptyState
              icon="📋"
              title="ยังไม่มีใครลงคิว"
              hint="ไปหน้า 'คิววันนี้' เพื่อลงชื่อหมอนวดก่อนเปิดรับลูกค้า"
            />
          ) : (
            <ul className="divide-y divide-sand-100">
              {rotation.members.map((m) => {
                const t = totalsFor(perTherapist, m.therapist_id);
                const isNext = rotation.next?.therapist_id === m.therapist_id;
                return (
                  <li
                    key={m.therapist_id}
                    className={`flex items-center gap-3 px-4 py-3 ${isNext ? "bg-jade-50" : ""}`}
                  >
                    <span className="w-7 shrink-0 text-center text-sm font-bold tabular-nums text-ink-300">
                      #{m.position}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-ink-800">
                        {m.name}
                        {isNext && <span className="ml-1.5 text-jade-600">🥇</span>}
                        {queue.find((q) => q.therapist_id === m.therapist_id)?.entry_type ===
                          "runner" && <span className="ml-1 text-amber-600" title="หมอวิ่ง">⚡</span>}
                      </span>
                      <span className="block text-[11px] text-ink-400">
                        งาน {t.jobs} · {baht(t.pay)}
                      </span>
                    </span>
                    <StatusPill status={m.derived} remainingMin={m.remainingMin} size="sm" />
                  </li>
                );
              })}
            </ul>
          )}
          {rotation.rotationOrder.length > 0 && (
            <p className="border-t border-sand-200 px-4 py-2.5 text-[11px] leading-relaxed text-ink-400">
              <span className="font-semibold text-ink-500">ลำดับวนคิวถัดไป →</span>{" "}
              {rotation.rotationOrder.map((m) => m.name).join(" → ")}
            </p>
          )}
        </section>

        {/* CENTER — active massages */}
        <section className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <p className="section-title">กำลังนวด ({sortedActive.length})</p>
            {counts.finishing > 0 && (
              <span className="pill bg-orange-50 text-orange-700 ring-1 ring-orange-200">
                ใกล้เสร็จ {counts.finishing}
              </span>
            )}
          </div>

          {loading ? (
            <div className="card">
              <EmptyState icon="⏳" title="กำลังโหลด…" />
            </div>
          ) : sortedActive.length === 0 ? (
            <div className="card">
              <EmptyState
                icon="🌿"
                title="ยังไม่มีลูกค้ากำลังใช้บริการ"
                hint="กดปุ่ม + รับลูกค้า เพื่อเริ่มงานใหม่"
              />
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {sortedActive.map((s) => (
                <ActiveSessionCard
                  key={s.id}
                  session={s}
                  onFinish={() => setFinishing(s)}
                  onExtend={() => {
                    setExtendPreset(undefined);
                    setExtending(s);
                  }}
                  onQuickExtend={(m) => {
                    setExtendPreset(m);
                    setExtending(s);
                  }}
                />
              ))}
            </div>
          )}
        </section>

        {/* RIGHT — next available, finishing soon, waiting */}
        <div className="space-y-4">
          <section className="card card-pad">
            <p className="section-title">หมอนวดที่ว่างคนถัดไป</p>
            {rotation.next ? (
              <p className="mt-1 text-2xl font-bold text-ink-800">🥇 {rotation.next.name}</p>
            ) : (
              <p className="mt-1 text-sm text-ink-400">ยังไม่มีใครว่าง</p>
            )}

            <p className="section-title mt-5">ใกล้จะว่าง</p>
            {rotation.upcoming.length === 0 ? (
              <p className="mt-1 text-sm text-ink-400">—</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {rotation.upcoming.map((m) => (
                  <li key={m.therapist_id} className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-ink-700">{m.name}</span>
                    <StatusPill status={m.derived} remainingMin={m.remainingMin} size="sm" />
                  </li>
                ))}
              </ul>
            )}

            {rotation.skipped.length > 0 && (
              <>
                <p className="section-title mt-5">ถูกข้ามในรอบนี้</p>
                <ul className="mt-1.5 space-y-1">
                  {rotation.skipped.map((s) => (
                    <li key={s.therapist_id} className="text-xs text-ink-400">
                      <span className="font-semibold text-ink-600">{s.name}</span> — {s.detail}
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-[11px] text-ink-400">
                  การถูกข้ามเพราะไม่ว่าง ไม่ทำให้เสียคิวถาวร
                </p>
              </>
            )}
          </section>

          {unpaid.length > 0 && (
            <section className="card ring-2 ring-amber-300">
              <div className="border-b border-sand-200 bg-amber-50 px-4 py-3">
                <p className="section-title !text-amber-800">
                  💰 รอเก็บเงิน ({unpaid.length})
                </p>
                <p className="mt-0.5 text-[11px] text-amber-700">
                  ระบบปิดงานให้อัตโนมัติแล้ว — กดช่องทางที่รับเงินเพื่อปิดยอด
                </p>
              </div>
              <ul className="divide-y divide-sand-100">
                {unpaid.map((s) => (
                  <li key={s.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-ink-800">
                          {rotation.members.find((m) => m.therapist_id === s.therapist_id)?.name ??
                            "—"}
                          <span className="ml-1.5 font-normal text-ink-400">
                            {s.customer_name || "ลูกค้าเดินเข้า"}
                          </span>
                        </p>
                        <p className="truncate text-xs text-ink-400">
                          {s.service_name_th || s.service_name_en} · เสร็จ {hhmm(s.finished_at)}
                        </p>
                      </div>
                      <span className="shrink-0 text-base font-bold tabular-nums text-ink-800">
                        {baht(s.final_price)}
                      </span>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-1.5">
                      {PAYMENT_METHODS.map((p) => (
                        <button
                          key={p.value}
                          disabled={settling}
                          onClick={() => void settle(s.id, p.value)}
                          className="btn-secondary btn-sm"
                        >
                          {p.icon} {p.label}
                        </button>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <WaitingPanel onSeat={(p) => openNew(p)} />
          <ActivityPanel limit={18} />
        </div>
      </div>

      <NewCustomerDrawer
        open={drawerOpen}
        prefill={prefill}
        onClose={() => setDrawerOpen(false)}
        onDone={flash}
      />
      <FinishDialog session={finishing} onClose={() => setFinishing(null)} onDone={flash} />
      <ExtendDialog
        session={extending}
        preset={extendPreset}
        onClose={() => setExtending(null)}
        onDone={flash}
      />

      {toast && <Toast message={toast.message} tone={toast.tone} />}
    </div>
  );
}
