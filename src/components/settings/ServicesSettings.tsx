"use client";

import { useState } from "react";
import { useShop } from "@/components/ShopProvider";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Modal, Toast } from "@/components/ui";
import { baht } from "@/lib/format";
import type { Service } from "@/lib/types";

type Draft = {
  id?: string;
  name_en: string;
  name_th: string;
  price: string;
  duration_min: string;
  default_therapist_pay: string;
  is_active: boolean;
  sort_order: string;
};

const BLANK: Draft = {
  name_en: "",
  name_th: "",
  price: "",
  duration_min: "60",
  default_therapist_pay: "",
  is_active: true,
  sort_order: "999",
};

export default function ServicesSettings() {
  const { services, refresh } = useShop();
  const supabase = supabaseBrowser();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: "ok" | "err" } | null>(null);

  function flash(message: string, tone: "ok" | "err" = "ok") {
    setToast({ message, tone });
    setTimeout(() => setToast(null), 2600);
  }

  function edit(s: Service) {
    setDraft({
      id: s.id,
      name_en: s.name_en,
      name_th: s.name_th ?? "",
      price: String(s.price),
      duration_min: String(s.duration_min),
      default_therapist_pay: String(s.default_therapist_pay),
      is_active: s.is_active,
      sort_order: String(s.sort_order),
    });
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    try {
      // ชื่อไทยเป็นหลัก — ถ้าไม่กรอกภาษาอังกฤษ ใช้ชื่อไทยแทน (คอลัมน์นี้ห้ามว่าง)
      const payload = {
        name_en: draft.name_en.trim() || draft.name_th.trim(),
        name_th: draft.name_th.trim() || null,
        price: Number(draft.price || 0),
        duration_min: Number(draft.duration_min || 0),
        default_therapist_pay: Number(draft.default_therapist_pay || 0),
        is_active: draft.is_active,
        sort_order: Number(draft.sort_order || 999),
      };
      if (!payload.name_en) throw new Error("กรุณาใส่ชื่อบริการ");
      if (payload.duration_min <= 0) throw new Error("ระยะเวลาต้องมากกว่า 0 นาที");

      const { error } = draft.id
        ? await supabase.from("services").update(payload).eq("id", draft.id)
        : await supabase.from("services").insert(payload);
      if (error) throw error;

      setDraft(null);
      await refresh();
      flash("บันทึกบริการแล้ว");
    } catch (err) {
      flash(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ", "err");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(s: Service) {
    setBusy(true);
    try {
      const { error } = await supabase
        .from("services")
        .update({ is_active: !s.is_active })
        .eq("id", s.id);
      if (error) throw error;
      await refresh();
      flash(s.is_active ? "ปิดการใช้งานบริการแล้ว" : "เปิดใช้งานบริการแล้ว");
    } catch (err) {
      flash(err instanceof Error ? err.message : "ทำรายการไม่สำเร็จ", "err");
    } finally {
      setBusy(false);
    }
  }

  async function remove(s: Service) {
    if (
      !confirm(
        `ลบบริการ "${s.name_en}"?\n\nถ้าเคยมีรายการขายบริการนี้ ระบบจะลบไม่ได้ — ให้ใช้ "ปิดใช้งาน" แทน (ประวัติเดิมจะไม่เปลี่ยน)`,
      )
    )
      return;
    setBusy(true);
    try {
      const { error } = await supabase.from("services").delete().eq("id", s.id);
      if (error) throw new Error("ลบไม่ได้ เพราะมีรายการขายอ้างอิงอยู่ — กรุณาใช้ปิดใช้งานแทน");
      await refresh();
      flash("ลบบริการแล้ว");
    } catch (err) {
      flash(err instanceof Error ? err.message : "ลบไม่สำเร็จ", "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-400">
          ราคาที่แก้ที่นี่จะใช้กับรายการใหม่เท่านั้น — รายการเก่าเก็บราคาไว้แล้วและไม่เปลี่ยนตาม
        </p>
        <button className="btn-primary" onClick={() => setDraft({ ...BLANK })}>
          + เพิ่มบริการ
        </button>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[760px]">
          <thead className="border-b border-sand-200 bg-sand-50">
            <tr>
              <th className="table-th">ชื่อบริการ</th>
              <th className="table-th text-right">ราคา</th>
              <th className="table-th text-right">นาที</th>
              <th className="table-th text-right">ค่าแรงหมอนวด</th>
              <th className="table-th text-right">ส่วนแบ่งร้าน</th>
              <th className="table-th">สถานะ</th>
              <th className="table-th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-sand-100">
            {services.map((s) => (
              <tr key={s.id} className={s.is_active ? "" : "bg-sand-50/60 opacity-60"}>
                <td className="table-td">
                  <p className="font-semibold text-ink-800">{s.name_th || s.name_en}</p>
                </td>
                <td className="table-td text-right font-semibold tabular-nums">{baht(s.price)}</td>
                <td className="table-td text-right tabular-nums">{s.duration_min}</td>
                <td className="table-td text-right tabular-nums">{baht(s.default_therapist_pay)}</td>
                <td className="table-td text-right tabular-nums text-jade-700">
                  {baht(Number(s.price) - Number(s.default_therapist_pay))}
                </td>
                <td className="table-td">
                  {s.is_active ? (
                    <span className="pill bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
                      เปิดใช้
                    </span>
                  ) : (
                    <span className="pill bg-slate-100 text-slate-600 ring-1 ring-slate-200">
                      ปิดใช้
                    </span>
                  )}
                </td>
                <td className="table-td">
                  <div className="flex justify-end gap-1">
                    <button className="btn-ghost btn-sm" onClick={() => edit(s)}>
                      แก้ไข
                    </button>
                    <button className="btn-ghost btn-sm" disabled={busy} onClick={() => void toggle(s)}>
                      {s.is_active ? "ปิด" : "เปิด"}
                    </button>
                    <button
                      className="btn-ghost btn-sm text-red-500"
                      disabled={busy}
                      onClick={() => void remove(s)}
                    >
                      ลบ
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal
        open={!!draft}
        onClose={() => setDraft(null)}
        title={draft?.id ? "แก้ไขบริการ" : "เพิ่มบริการใหม่"}
        footer={
          <div className="flex gap-3">
            <button className="btn-secondary flex-1" onClick={() => setDraft(null)}>
              ยกเลิก
            </button>
            <button className="btn-primary flex-1" disabled={busy} onClick={() => void save()}>
              บันทึก
            </button>
          </div>
        }
      >
        {draft && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label">ชื่อบริการ *</label>
                <input
                  className="input"
                  value={draft.name_th}
                  onChange={(e) => setDraft({ ...draft, name_th: e.target.value })}
                  placeholder="เช่น นวดอโรม่า"
                />
              </div>
              <div>
                <label className="label">ชื่อภาษาอังกฤษ (ไม่บังคับ)</label>
                <input
                  className="input"
                  value={draft.name_en}
                  onChange={(e) => setDraft({ ...draft, name_en: e.target.value })}
                  placeholder="ใช้เฉพาะในไฟล์ที่ส่งออก"
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="label">ราคา (฿)</label>
                <input
                  className="input"
                  type="number"
                  inputMode="decimal"
                  value={draft.price}
                  onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                />
              </div>
              <div>
                <label className="label">ระยะเวลา (นาที)</label>
                <input
                  className="input"
                  type="number"
                  inputMode="numeric"
                  value={draft.duration_min}
                  onChange={(e) => setDraft({ ...draft, duration_min: e.target.value })}
                />
              </div>
              <div>
                <label className="label">ค่าแรงหมอนวด (฿)</label>
                <input
                  className="input"
                  type="number"
                  inputMode="decimal"
                  value={draft.default_therapist_pay}
                  onChange={(e) => setDraft({ ...draft, default_therapist_pay: e.target.value })}
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label">ลำดับการแสดง</label>
                <input
                  className="input"
                  type="number"
                  value={draft.sort_order}
                  onChange={(e) => setDraft({ ...draft, sort_order: e.target.value })}
                />
              </div>
              <label className="flex cursor-pointer items-center gap-3 self-end rounded-xl bg-sand-50 px-4 py-3 ring-1 ring-sand-300">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-jade-600"
                  checked={draft.is_active}
                  onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })}
                />
                <span className="text-sm font-medium">เปิดใช้งาน (แสดงตอนรับลูกค้า)</span>
              </label>
            </div>
            <p className="rounded-xl bg-sand-100 px-4 py-3 text-xs leading-relaxed text-ink-500">
              ค่าแรงหมอนวดที่ตั้งไว้นี้เป็นเพียง <strong>ค่าเริ่มต้น</strong> — ยังแก้ได้ทุกครั้งตอนรับลูกค้า
              และระบบเก็บทั้งค่าเริ่มต้นและค่าที่จ่ายจริงแยกกัน
            </p>
          </div>
        )}
      </Modal>

      {toast && <Toast message={toast.message} tone={toast.tone} />}
    </div>
  );
}
