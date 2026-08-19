"use client";

import { useState } from "react";
import { useShop } from "@/components/ShopProvider";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Modal, Toast } from "@/components/ui";
import { baht } from "@/lib/format";
import type { Therapist } from "@/lib/types";

type Draft = {
  id?: string;
  name: string;
  nickname: string;
  phone: string;
  is_active: boolean;
  is_runner: boolean;
  pay_override_30: string;
  pay_override_60: string;
  notes: string;
};

const BLANK: Draft = {
  name: "",
  nickname: "",
  phone: "",
  is_active: true,
  is_runner: false,
  pay_override_30: "",
  pay_override_60: "",
  notes: "",
};

export default function TherapistsSettings() {
  const { therapists, refresh } = useShop();
  const supabase = supabaseBrowser();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: "ok" | "err" } | null>(null);

  function flash(message: string, tone: "ok" | "err" = "ok") {
    setToast({ message, tone });
    setTimeout(() => setToast(null), 2600);
  }

  function edit(t: Therapist) {
    setDraft({
      id: t.id,
      name: t.name,
      nickname: t.nickname ?? "",
      phone: t.phone ?? "",
      is_active: t.is_active,
      is_runner: t.is_runner,
      pay_override_30: t.pay_override_30 == null ? "" : String(t.pay_override_30),
      pay_override_60: t.pay_override_60 == null ? "" : String(t.pay_override_60),
      notes: t.notes ?? "",
    });
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    try {
      if (!draft.name.trim()) throw new Error("กรุณาใส่ชื่อหมอนวด");
      const payload = {
        name: draft.name.trim(),
        nickname: draft.nickname.trim() || null,
        phone: draft.phone.trim() || null,
        is_active: draft.is_active,
        is_runner: draft.is_runner,
        pay_override_30: draft.pay_override_30 === "" ? null : Number(draft.pay_override_30),
        pay_override_60: draft.pay_override_60 === "" ? null : Number(draft.pay_override_60),
        notes: draft.notes.trim() || null,
      };
      const { error } = draft.id
        ? await supabase.from("therapists").update(payload).eq("id", draft.id)
        : await supabase.from("therapists").insert(payload);
      if (error) throw error;
      setDraft(null);
      await refresh();
      flash("บันทึกข้อมูลหมอนวดแล้ว");
    } catch (err) {
      flash(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ", "err");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(t: Therapist) {
    setBusy(true);
    try {
      const { error } = await supabase
        .from("therapists")
        .update({ is_active: !t.is_active })
        .eq("id", t.id);
      if (error) throw error;
      await refresh();
      flash(t.is_active ? "ปิดใช้งานหมอนวดแล้ว" : "เปิดใช้งานหมอนวดแล้ว");
    } catch (err) {
      flash(err instanceof Error ? err.message : "ทำรายการไม่สำเร็จ", "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-400">
          ห้ามลบหมอนวดที่เคยมีรายการขาย — ใช้ <strong>ปิดใช้งาน</strong> แทน
          ประวัติและยอดเดิมจะยังอยู่ครบ
        </p>
        <button className="btn-primary" onClick={() => setDraft({ ...BLANK })}>
          + เพิ่มหมอนวด
        </button>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[720px]">
          <thead className="border-b border-sand-200 bg-sand-50">
            <tr>
              <th className="table-th">ชื่อ</th>
              <th className="table-th">ชื่อเล่น</th>
              <th className="table-th">โทรศัพท์</th>
              <th className="table-th text-right">ค่าแรง 30 นาที</th>
              <th className="table-th text-right">ค่าแรง 60 นาที</th>
              <th className="table-th">สถานะ</th>
              <th className="table-th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-sand-100">
            {therapists.map((t) => (
              <tr key={t.id} className={t.is_active ? "" : "bg-sand-50/60 opacity-60"}>
                <td className="table-td">
                  <p className="font-semibold text-ink-800">
                    {t.name}
                    {t.is_runner && (
                      <span className="ml-2 pill bg-amber-100 text-amber-800 ring-1 ring-amber-300">
                        ⚡ หมอวิ่ง
                      </span>
                    )}
                  </p>
                  {t.notes && <p className="max-w-[240px] truncate text-xs text-ink-400">{t.notes}</p>}
                </td>
                <td className="table-td">{t.nickname ?? "—"}</td>
                <td className="table-td">{t.phone ?? "—"}</td>
                <td className="table-td text-right tabular-nums">
                  {t.pay_override_30 == null ? "ตามบริการ" : baht(t.pay_override_30)}
                </td>
                <td className="table-td text-right tabular-nums">
                  {t.pay_override_60 == null ? "ตามบริการ" : baht(t.pay_override_60)}
                </td>
                <td className="table-td">
                  {t.is_active ? (
                    <span className="pill bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
                      เปิดใช้งาน
                    </span>
                  ) : (
                    <span className="pill bg-slate-100 text-slate-600 ring-1 ring-slate-200">
                      ปิดใช้งาน
                    </span>
                  )}
                </td>
                <td className="table-td">
                  <div className="flex justify-end gap-1">
                    <button className="btn-ghost btn-sm" onClick={() => edit(t)}>
                      แก้ไข
                    </button>
                    <button className="btn-ghost btn-sm" disabled={busy} onClick={() => void toggle(t)}>
                      {t.is_active ? "ปิดใช้งาน" : "เปิดใช้งาน"}
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
        title={draft?.id ? "แก้ไขข้อมูลหมอนวด" : "เพิ่มหมอนวดใหม่"}
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
                <label className="label">ชื่อ *</label>
                <input
                  className="input"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </div>
              <div>
                <label className="label">ชื่อเล่น</label>
                <input
                  className="input"
                  value={draft.nickname}
                  onChange={(e) => setDraft({ ...draft, nickname: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label className="label">โทรศัพท์ (ไม่บังคับ)</label>
              <input
                className="input"
                inputMode="tel"
                value={draft.phone}
                onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label">ค่าแรง 30 นาที (เว้นว่าง = ใช้ค่าของบริการ)</label>
                <input
                  className="input"
                  type="number"
                  inputMode="decimal"
                  value={draft.pay_override_30}
                  onChange={(e) => setDraft({ ...draft, pay_override_30: e.target.value })}
                  placeholder="ตามที่ตั้งในบริการ"
                />
              </div>
              <div>
                <label className="label">ค่าแรง 60 นาที (เว้นว่าง = ใช้ค่าของบริการ)</label>
                <input
                  className="input"
                  type="number"
                  inputMode="decimal"
                  value={draft.pay_override_60}
                  onChange={(e) => setDraft({ ...draft, pay_override_60: e.target.value })}
                  placeholder="ตามที่ตั้งในบริการ"
                />
              </div>
            </div>
            <div>
              <label className="label">โน้ต</label>
              <textarea
                className="input py-3"
                rows={3}
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              />
            </div>
            <label className="flex cursor-pointer items-center gap-3 rounded-xl bg-sand-50 px-4 py-3 ring-1 ring-sand-300">
              <input
                type="checkbox"
                className="h-5 w-5 accent-jade-600"
                checked={draft.is_active}
                onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })}
              />
              <span className="text-sm font-medium">เปิดใช้งาน (ลงคิวได้)</span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-amber-50 px-4 py-3 ring-1 ring-amber-200">
              <input
                type="checkbox"
                className="mt-0.5 h-5 w-5 accent-amber-600"
                checked={draft.is_runner}
                onChange={(e) => setDraft({ ...draft, is_runner: e.target.checked })}
              />
              <span>
                <span className="block text-sm font-medium">⚡ เป็นหมอวิ่ง</span>
                <span className="block text-xs text-ink-400">
                  หมอนวดนอกร้าน ไม่ต้องลงคิวทุกเช้า — จะขึ้นให้เลือกเฉพาะตอนคนในร้านไม่พอ
                </span>
              </span>
            </label>
          </div>
        )}
      </Modal>

      {toast && <Toast message={toast.message} tone={toast.tone} />}
    </div>
  );
}
