"use client";

import { useCallback, useEffect, useState } from "react";
import { useShop } from "@/components/ShopProvider";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Toast } from "@/components/ui";
import { bangkokToday, shortDate } from "@/lib/format";
import { pushDayToSheets, testSheetsConnection } from "@/lib/sheets";
import type { SheetsSyncLog } from "@/lib/types";

export default function SheetsSettings() {
  const { settings, refresh } = useShop();
  const supabase = supabaseBrowser();

  const [url, setUrl] = useState(settings.sheets_webapp_url ?? "");
  const [secret, setSecret] = useState(settings.sheets_secret ?? "");
  const [autoOnClose, setAutoOnClose] = useState(settings.sheets_auto_on_close);
  const [showSecret, setShowSecret] = useState(false);
  const [busy, setBusy] = useState<null | "save" | "test" | "push">(null);
  const [logs, setLogs] = useState<SheetsSyncLog[]>([]);
  const [pending, setPending] = useState<{ work_date: string; total_jobs: number }[]>([]);
  const [pushDate, setPushDate] = useState(bangkokToday());
  const [toast, setToast] = useState<{ message: string; tone: "ok" | "err" } | null>(null);

  useEffect(() => {
    setUrl(settings.sheets_webapp_url ?? "");
    setSecret(settings.sheets_secret ?? "");
    setAutoOnClose(settings.sheets_auto_on_close);
  }, [settings.sheets_webapp_url, settings.sheets_secret, settings.sheets_auto_on_close]);

  const loadLogs = useCallback(async () => {
    const [l, p] = await Promise.all([
      supabase
        .from("sheets_sync_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(12),
      supabase
        .from("v_sheets_pending_days")
        .select("work_date, total_jobs")
        .order("work_date", { ascending: false })
        .limit(30),
    ]);
    setLogs((l.data ?? []) as SheetsSyncLog[]);
    setPending((p.data ?? []) as { work_date: string; total_jobs: number }[]);
  }, [supabase]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  function flash(message: string, tone: "ok" | "err" = "ok") {
    setToast({ message, tone });
    setTimeout(() => setToast(null), 4000);
  }

  async function save() {
    setBusy("save");
    try {
      const { error } = await supabase
        .from("shop_settings")
        .update({
          sheets_webapp_url: url.trim() || null,
          sheets_secret: secret.trim() || null,
          sheets_auto_on_close: autoOnClose,
          updated_at: new Date().toISOString(),
        })
        .eq("id", true);
      if (error) throw error;
      await refresh();
      flash("บันทึกการเชื่อมต่อแล้ว");
    } catch (e) {
      flash(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ", "err");
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy("test");
    const r = await testSheetsConnection();
    flash(r.ok ? "เชื่อมต่อสำเร็จ ✓ พร้อมส่งข้อมูลแล้ว" : r.error ?? "เชื่อมต่อไม่สำเร็จ", r.ok ? "ok" : "err");
    setBusy(null);
  }

  async function push(date: string) {
    setBusy("push");
    const r = await pushDayToSheets(date, "manual");
    flash(
      r.ok
        ? `ส่งข้อมูลวันที่ ${date} เข้า Google Sheets แล้ว (${r.rows ?? 0} รายการ)`
        : r.error ?? "ส่งไม่สำเร็จ",
      r.ok ? "ok" : "err",
    );
    await Promise.all([loadLogs(), refresh()]);
    setBusy(null);
  }

  const connected = Boolean(settings.sheets_webapp_url);

  return (
    <div className="space-y-4">
      <section className="card card-pad space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-base font-bold text-ink-800">เซฟข้อมูลทุกวันลง Google Sheets</p>
            <p className="mt-1 text-sm text-ink-400">
              ทุกครั้งที่ปิดวัน ระบบจะส่งรายละเอียดของวันนั้นเข้าไฟล์ Google Sheets ของร้านให้เอง
              — เก็บไว้เป็นหลักฐาน เปิดดูย้อนหลังได้ทุกเมื่อ แม้ไม่ได้เปิดโปรแกรม
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
              connected ? "bg-jade-50 text-jade-700 ring-1 ring-jade-200" : "bg-sand-100 text-ink-400"
            }`}
          >
            {connected ? "เชื่อมต่อแล้ว" : "ยังไม่เชื่อมต่อ"}
          </span>
        </div>

        <div className="rounded-xl bg-sand-50 px-4 py-3 text-xs leading-relaxed text-ink-500 ring-1 ring-sand-300">
          <p className="font-semibold text-ink-700">ตั้งค่าครั้งเดียว (ประมาณ 3 นาที)</p>
          <ol className="mt-1.5 list-decimal space-y-0.5 pl-5">
            <li>สร้าง Google Sheet ใหม่ ตั้งชื่อว่า “EUNOIA — ข้อมูลรายวัน”</li>
            <li>
              ในไฟล์นั้น กด <strong>ส่วนขยาย (Extensions) → Apps Script</strong>{" "}
              แล้ววางโค้ดจากไฟล์ <code>google-sheets/EUNOIA-AppsScript.gs</code>
            </li>
            <li>แก้บรรทัด SECRET ในโค้ดเป็นรหัสลับที่ตั้งเอง แล้วกดบันทึก</li>
            <li>
              กด <strong>ทำให้ใช้งานได้ (Deploy) → เว็บแอป</strong> · ดำเนินการในชื่อ:{" "}
              <strong>ฉัน</strong> · ผู้มีสิทธิ์เข้าถึง: <strong>ทุกคน (Anyone)</strong>
            </li>
            <li>คัดลอกลิงก์ที่ลงท้ายด้วย /exec มาวางข้างล่างนี้ พร้อมรหัสลับเดียวกัน</li>
          </ol>
        </div>

        <div>
          <label className="label">ลิงก์ Web App (ลงท้ายด้วย /exec)</label>
          <input
            className="input w-full"
            placeholder="https://script.google.com/macros/s/……/exec"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>

        <div>
          <label className="label">รหัสลับ (ต้องตรงกับบรรทัด SECRET ในโค้ด)</label>
          <div className="flex gap-2">
            <input
              className="input w-full"
              type={showSecret ? "text" : "password"}
              placeholder="เช่น eunoia-2026"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
            <button className="btn-ghost shrink-0" onClick={() => setShowSecret((s) => !s)}>
              {showSecret ? "ซ่อน" : "ดู"}
            </button>
          </div>
        </div>

        <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-sand-50 px-4 py-4 ring-1 ring-sand-300">
          <input
            type="checkbox"
            className="mt-0.5 h-6 w-6 accent-jade-600"
            checked={autoOnClose}
            onChange={(e) => setAutoOnClose(e.target.checked)}
          />
          <span>
            <span className="block text-sm font-semibold text-ink-800">
              ส่งอัตโนมัติทุกครั้งที่ปิดวัน
            </span>
            <span className="mt-0.5 block text-xs leading-relaxed text-ink-400">
              ถ้าปิดสวิตช์นี้ ยังส่งเองได้จากปุ่มข้างล่าง หรือจากหน้า “รายงานสรุป &amp; ปิดวัน”
            </span>
          </span>
        </label>

        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" disabled={busy !== null} onClick={() => void save()}>
            บันทึกการเชื่อมต่อ
          </button>
          <button
            className="btn-ghost"
            disabled={busy !== null || !connected}
            onClick={() => void test()}
          >
            {busy === "test" ? "กำลังทดสอบ…" : "ทดสอบการเชื่อมต่อ"}
          </button>
        </div>

        {settings.sheets_last_sync_at && (
          <p className="text-xs text-ink-400">
            ส่งครั้งล่าสุด: {shortDate(settings.sheets_last_sync_at)}{" "}
            {settings.sheets_last_date && `· ข้อมูลของวันที่ ${settings.sheets_last_date}`}{" "}
            <span
              className={
                settings.sheets_last_status === "ok" ? "text-jade-700" : "text-rose-600"
              }
            >
              ({settings.sheets_last_status === "ok" ? "สำเร็จ" : "ไม่สำเร็จ"})
            </span>
          </p>
        )}
      </section>

      <section className="card card-pad space-y-3">
        <div>
          <p className="text-base font-bold text-ink-800">ส่งข้อมูลย้อนหลังเอง</p>
          <p className="mt-1 text-sm text-ink-400">
            เลือกวันที่แล้วกดส่ง — ส่งซ้ำวันเดิมได้ ข้อมูลในชีตจะถูกเขียนทับ ไม่เกิดแถวซ้ำ
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="label">วันที่</label>
            <input
              type="date"
              className="h-11 rounded-xl bg-white px-3 text-sm ring-1 ring-sand-300"
              value={pushDate}
              onChange={(e) => setPushDate(e.target.value)}
            />
          </div>
          <button
            className="btn-primary"
            disabled={busy !== null || !connected}
            onClick={() => void push(pushDate)}
          >
            {busy === "push" ? "กำลังส่ง…" : "ส่งเข้า Google Sheets"}
          </button>
        </div>

        {pending.length > 0 && (
          <div className="rounded-xl bg-amber-50 px-4 py-3 ring-1 ring-amber-200">
            <p className="text-xs font-semibold text-amber-800">
              วันที่ยังไม่เคยส่งเข้าชีตสำเร็จ ({pending.length} วัน)
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {pending.slice(0, 14).map((d) => (
                <button
                  key={d.work_date}
                  disabled={busy !== null || !connected}
                  onClick={() => void push(d.work_date)}
                  className="rounded-lg bg-white px-2.5 py-1.5 text-xs font-semibold text-ink-700 ring-1 ring-amber-200"
                >
                  {d.work_date} · {d.total_jobs} งาน
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="card card-pad space-y-3">
        <p className="text-base font-bold text-ink-800">ประวัติการส่ง</p>
        {logs.length === 0 ? (
          <p className="text-sm text-ink-400">ยังไม่เคยส่งข้อมูลเข้า Google Sheets</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-400">
                  <th className="py-2">เวลาที่ส่ง</th>
                  <th>ข้อมูลของวันที่</th>
                  <th>ผล</th>
                  <th>รายการ</th>
                  <th>สั่งโดย</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="border-t border-sand-200">
                    <td className="py-2 text-ink-500">{shortDate(l.created_at)}</td>
                    <td className="text-ink-700">{l.work_date}</td>
                    <td>
                      <span
                        className={
                          l.status === "ok"
                            ? "font-semibold text-jade-700"
                            : "font-semibold text-rose-600"
                        }
                      >
                        {l.status === "ok" ? "สำเร็จ" : "ไม่สำเร็จ"}
                      </span>
                      {l.status === "error" && l.message && (
                        <span className="ml-1 text-xs text-ink-400">{l.message}</span>
                      )}
                    </td>
                    <td className="text-ink-500">{l.rows_sent}</td>
                    <td className="text-xs text-ink-400">
                      {l.trigger_by === "close_day"
                        ? "ปิดวันอัตโนมัติ"
                        : l.trigger_by === "test"
                          ? "ทดสอบ"
                          : "กดส่งเอง"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {toast && <Toast message={toast.message} tone={toast.tone} />}
    </div>
  );
}
