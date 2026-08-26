"use client";

import { useEffect, useState } from "react";
import { useShop } from "@/components/ShopProvider";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Toast } from "@/components/ui";

export default function GeneralSettings() {
  const { settings, refresh } = useShop();
  const supabase = supabaseBrowser();
  const [enabled, setEnabled] = useState(settings.auto_finish_enabled);
  const [grace, setGrace] = useState(String(settings.auto_finish_grace_min));
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: "ok" | "err" } | null>(null);

  useEffect(() => {
    setEnabled(settings.auto_finish_enabled);
    setGrace(String(settings.auto_finish_grace_min));
  }, [settings.auto_finish_enabled, settings.auto_finish_grace_min]);

  function flash(message: string, tone: "ok" | "err" = "ok") {
    setToast({ message, tone });
    setTimeout(() => setToast(null), 2800);
  }

  async function save() {
    setBusy(true);
    try {
      const g = Math.max(0, Math.min(60, Number(grace) || 0));
      const { error } = await supabase
        .from("shop_settings")
        .update({
          auto_finish_enabled: enabled,
          auto_finish_grace_min: g,
          updated_at: new Date().toISOString(),
        })
        .eq("id", true);
      if (error) throw error;
      await refresh();
      flash("บันทึกการตั้งค่าแล้ว");
    } catch (e) {
      flash(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ", "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="card card-pad space-y-4">
        <div>
          <p className="text-base font-bold text-ink-800">ปิดงานอัตโนมัติเมื่อครบเวลา</p>
          <p className="mt-1 text-sm text-ink-400">
            เมื่อครบเวลาที่กำหนด ระบบจะปิดงานให้เอง หมอนวดกลับเป็น &quot;ว่าง&quot;
            ทันทีโดยไม่ต้องกดปุ่ม
          </p>
        </div>

        <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-sand-50 px-4 py-4 ring-1 ring-sand-300">
          <input
            type="checkbox"
            className="mt-0.5 h-6 w-6 accent-jade-600"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <span>
            <span className="block text-sm font-semibold text-ink-800">
              {enabled ? "เปิดใช้งาน — ครบเวลาแล้วปิดงานให้เลย" : "ปิดใช้งาน — ต้องกดปุ่ม “นวดเสร็จ” เอง"}
            </span>
            <span className="mt-0.5 block text-xs leading-relaxed text-ink-400">
              ถ้าปิดสวิตช์นี้ พอหมดเวลาการ์ดจะขึ้นว่า &quot;หมดเวลา — รอกดปุ่มนวดเสร็จ&quot;
              และหมอนวดจะยังไม่ว่างจนกว่าจะมีคนกด (เหมาะกับร้านที่ลูกค้ามักนวดเกินเวลา)
            </span>
          </span>
        </label>

        {enabled && (
          <div>
            <label className="label">ผ่อนผันกี่นาทีก่อนปิดให้</label>
            <div className="flex flex-wrap items-center gap-2">
              {[0, 5, 10, 15].map((n) => (
                <button
                  key={n}
                  onClick={() => setGrace(String(n))}
                  className={`rounded-xl px-4 py-2.5 text-sm font-semibold ${
                    Number(grace) === n
                      ? "bg-jade-600 text-white"
                      : "bg-white ring-1 ring-sand-300"
                  }`}
                >
                  {n === 0 ? "ปิดทันที" : `+${n} นาที`}
                </button>
              ))}
              <input
                className="input w-28"
                type="number"
                min={0}
                max={60}
                value={grace}
                onChange={(e) => setGrace(e.target.value)}
              />
            </div>
            <p className="mt-1.5 text-xs text-ink-400">
              เช่น ตั้ง +10 นาที = ครบชั่วโมงแล้วรออีก 10 นาที ค่อยปิดให้
              เผื่อเวลาเก็บของและพาลูกค้าออก
            </p>
          </div>
        )}

        {enabled && (
          <p className="rounded-xl bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-800 ring-1 ring-amber-200">
            <strong>สำคัญเรื่องเงิน:</strong> งานที่ระบบปิดให้อัตโนมัติจะ{" "}
            <strong>ยังไม่ระบุช่องทางชำระ</strong> และจะไปอยู่ในกล่อง{" "}
            <strong>&quot;รอเก็บเงิน&quot;</strong> บนหน้าร้าน — กดจากตรงนั้นเพื่อระบุว่ารับเงินสด
            / QR / บัตร (ยอดขายนับเข้าแล้ว แต่จะค้างอยู่ในช่อง &quot;ยังไม่ระบุช่องทางชำระ&quot;
            ในหน้าการเงิน จนกว่าจะกดเก็บเงิน)
          </p>
        )}

        <button className="btn-primary" disabled={busy} onClick={() => void save()}>
          <span className="mr-1.5" aria-hidden>💾</span>บันทึกการตั้งค่า
        </button>
      </section>

      {toast && <Toast message={toast.message} tone={toast.tone} />}
    </div>
  );
}
