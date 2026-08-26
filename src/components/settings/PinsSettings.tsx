"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Toast } from "@/components/ui";
import { shortDate } from "@/lib/format";
import type { LoginPinRow, Profile } from "@/lib/types";

export default function PinsSettings() {
  const supabase = supabaseBrowser();
  const [pins, setPins] = useState<LoginPinRow[]>([]);
  const [people, setPeople] = useState<Profile[]>([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: "ok" | "err" } | null>(null);

  const [label, setLabel] = useState("");
  const [profileId, setProfileId] = useState("");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");

  function flash(message: string, tone: "ok" | "err" = "ok") {
    setToast({ message, tone });
    setTimeout(() => setToast(null), 3200);
  }

  async function load() {
    const [{ data: pinRows, error: pinErr }, { data: profileRows }] = await Promise.all([
      supabase.from("v_login_pins").select("*").order("label"),
      supabase.from("profiles").select("*").eq("is_active", true).order("role"),
    ]);
    if (pinErr) flash(pinErr.message, "err");
    setPins((pinRows ?? []) as LoginPinRow[]);
    setPeople((profileRows ?? []) as Profile[]);
    if (!profileId && profileRows?.length) setProfileId((profileRows[0] as Profile).id);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    if (!label.trim()) return flash("ใส่ชื่อเรียกก่อน เช่น หน้าร้าน", "err");
    if (!/^[0-9]{6}$/.test(pin)) return flash("PIN ต้องเป็นตัวเลข 6 หลัก", "err");
    if (pin !== pin2) return flash("ใส่ PIN สองช่องไม่ตรงกัน", "err");
    if (!profileId) return flash("เลือกบัญชีที่จะผูกกับ PIN นี้", "err");

    setBusy(true);
    try {
      const { error } = await supabase.rpc("set_login_pin", {
        p_label: label.trim(),
        p_profile_id: profileId,
        p_pin: pin,
      });
      if (error) throw error;
      setPin("");
      setPin2("");
      setLabel("");
      await load();
      flash("ตั้ง PIN เรียบร้อย");
    } catch (err) {
      flash(err instanceof Error ? err.message : "ตั้ง PIN ไม่สำเร็จ", "err");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(row: LoginPinRow) {
    setBusy(true);
    try {
      const { error } = await supabase
        .from("login_pins")
        .update({ is_active: !row.is_active })
        .eq("id", row.id);
      if (error) throw error;
      await load();
      flash(row.is_active ? "ปิดใช้ PIN นี้แล้ว" : "เปิดใช้ PIN นี้แล้ว");
    } catch (err) {
      flash(err instanceof Error ? err.message : "อัปเดตไม่สำเร็จ", "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="rounded-xl bg-sand-100 px-4 py-3 text-sm leading-relaxed text-ink-500">
        ใส่ PIN 6 หลักที่หน้าเข้าระบบแทนอีเมลกับรหัสผ่าน · PIN หนึ่งอันผูกกับหนึ่งบัญชี
        <br />
        ระบบเก็บแค่ <strong>ลายนิ้วมือ</strong> ของ PIN ไม่ได้เก็บตัวเลขจริง — ลืมแล้วดูย้อนไม่ได้
        ต้องตั้งใหม่ · กรอกผิด 5 ครั้งใน 15 นาที เครื่องนั้นจะถูกล็อกชั่วคราว
      </p>

      <div className="card card-pad space-y-4">
        <p className="section-title">ตั้ง / เปลี่ยน PIN</p>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">ชื่อเรียก</label>
            <input
              className="input"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="เช่น หน้าร้าน หรือ เจ้าของร้าน"
            />
            <p className="mt-1 text-[11px] text-ink-400">
              ใช้ชื่อเดิมซ้ำ = เปลี่ยน PIN ของอันนั้น · ชื่อใหม่ = เพิ่ม PIN อีกอัน
            </p>
          </div>

          <div>
            <label className="label">เข้าเป็นบัญชี</label>
            <select
              className="input"
              value={profileId}
              onChange={(e) => setProfileId(e.target.value)}
            >
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name || p.email} · {p.role === "owner" ? "เจ้าของร้าน" : "พนักงานหน้าร้าน"}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-ink-400">
              เลือกบัญชีพนักงานถ้าไม่อยากให้คนหน้าร้านเห็นการเงิน
            </p>
          </div>

          <div>
            <label className="label">PIN 6 หลัก</label>
            <input
              className="input tabular-nums"
              inputMode="numeric"
              maxLength={6}
              autoComplete="off"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
            />
          </div>

          <div>
            <label className="label">ใส่ PIN อีกครั้ง</label>
            <input
              className="input tabular-nums"
              inputMode="numeric"
              maxLength={6}
              autoComplete="off"
              value={pin2}
              onChange={(e) => setPin2(e.target.value.replace(/\D/g, "").slice(0, 6))}
            />
          </div>
        </div>

        <button className="btn-primary" disabled={busy} onClick={() => void save()}>
          <span className="mr-1.5" aria-hidden>
            💾
          </span>
          บันทึก PIN
        </button>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[560px]">
          <thead className="border-b border-sand-200 bg-sand-50">
            <tr>
              <th className="table-th">ชื่อเรียก</th>
              <th className="table-th">เข้าเป็นบัญชี</th>
              <th className="table-th">แก้ล่าสุด</th>
              <th className="table-th">สถานะ</th>
              <th className="table-th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-sand-100">
            {pins.length === 0 ? (
              <tr>
                <td className="table-td text-ink-400" colSpan={5}>
                  ยังไม่ได้ตั้ง PIN — ตอนนี้ยังต้องเข้าด้วยอีเมลและรหัสผ่าน
                </td>
              </tr>
            ) : (
              pins.map((row) => (
                <tr key={row.id} className={row.is_active ? "" : "opacity-60"}>
                  <td className="table-td font-semibold text-ink-800">{row.label}</td>
                  <td className="table-td">
                    <p className="text-ink-800">{row.full_name || row.email}</p>
                    <p className="text-xs text-ink-400">
                      {row.role === "owner" ? "เจ้าของร้าน · เห็นทุกอย่าง" : "พนักงานหน้าร้าน"}
                    </p>
                  </td>
                  <td className="table-td">{shortDate(row.updated_at)}</td>
                  <td className="table-td">
                    {row.is_active ? (
                      <span className="pill bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
                        ใช้ได้
                      </span>
                    ) : (
                      <span className="pill bg-slate-100 text-slate-600 ring-1 ring-slate-200">
                        ปิดอยู่
                      </span>
                    )}
                  </td>
                  <td className="table-td text-right">
                    <button
                      className="btn-ghost btn-sm"
                      disabled={busy}
                      onClick={() => void toggle(row)}
                    >
                      {row.is_active ? "ปิดใช้" : "เปิดใช้"}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {toast && <Toast message={toast.message} tone={toast.tone} />}
    </div>
  );
}
