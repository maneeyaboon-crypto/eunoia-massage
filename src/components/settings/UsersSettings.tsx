"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Toast } from "@/components/ui";
import { shortDate } from "@/lib/format";
import type { Profile, Role } from "@/lib/types";

const ROLE_LABEL: Record<Role, string> = {
  owner: "เห็นทุกอย่าง · แก้ตั้งค่า · ดูการเงิน · ยกเลิกรายการ",
  admin: "ลงคิว · รับลูกค้า · เริ่ม-จบนวด · รับเงิน",
};

export default function UsersSettings() {
  const supabase = supabaseBrowser();
  const [rows, setRows] = useState<Profile[]>([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: "ok" | "err" } | null>(null);

  function flash(message: string, tone: "ok" | "err" = "ok") {
    setToast({ message, tone });
    setTimeout(() => setToast(null), 2600);
  }

  async function load() {
    const { data, error } = await supabase.from("profiles").select("*").order("created_at");
    if (error) flash(error.message, "err");
    setRows((data ?? []) as Profile[]);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function update(id: string, patch: Partial<Profile>) {
    setBusy(true);
    try {
      const { error } = await supabase.from("profiles").update(patch).eq("id", id);
      if (error) throw error;
      await load();
      flash("อัปเดตผู้ใช้แล้ว");
    } catch (err) {
      flash(err instanceof Error ? err.message : "อัปเดตไม่สำเร็จ", "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="rounded-xl bg-sand-100 px-4 py-3 text-sm leading-relaxed text-ink-500">
        พนักงานใหม่ให้สมัครเองที่หน้า <strong>เข้าสู่ระบบ → สร้างบัญชี</strong>
        แล้วเจ้าของร้านมาเปลี่ยนสิทธิ์ที่หน้านี้ (บัญชีแรกของร้านจะเป็นเจ้าของร้านอัตโนมัติ)
      </p>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[680px]">
          <thead className="border-b border-sand-200 bg-sand-50">
            <tr>
              <th className="table-th">ผู้ใช้</th>
              <th className="table-th">สิทธิ์การใช้งาน</th>
              <th className="table-th">สร้างเมื่อ</th>
              <th className="table-th">สถานะ</th>
              <th className="table-th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-sand-100">
            {rows.map((p) => (
              <tr key={p.id} className={p.is_active ? "" : "opacity-60"}>
                <td className="table-td">
                  <p className="font-semibold text-ink-800">{p.full_name || "—"}</p>
                  <p className="text-xs text-ink-400">{p.email}</p>
                </td>
                <td className="table-td">
                  <select
                    className="h-11 rounded-xl bg-sand-50 px-3 text-sm ring-1 ring-sand-300"
                    value={p.role}
                    disabled={busy}
                    onChange={(e) => void update(p.id, { role: e.target.value as Role })}
                  >
                    <option value="owner">เจ้าของร้าน</option>
                    <option value="admin">พนักงานหน้าร้าน</option>
                  </select>
                  <p className="mt-1 max-w-[280px] text-[11px] leading-snug text-ink-400">
                    {ROLE_LABEL[p.role]}
                  </p>
                </td>
                <td className="table-td">{shortDate(p.created_at)}</td>
                <td className="table-td">
                  {p.is_active ? (
                    <span className="pill bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
                      ใช้งานได้
                    </span>
                  ) : (
                    <span className="pill bg-slate-100 text-slate-600 ring-1 ring-slate-200">
                      ปิดใช้งาน
                    </span>
                  )}
                </td>
                <td className="table-td text-right">
                  <button
                    className="btn-ghost btn-sm"
                    disabled={busy}
                    onClick={() => void update(p.id, { is_active: !p.is_active })}
                  >
                    {p.is_active ? "ปิดใช้งาน" : "เปิดใช้งาน"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {toast && <Toast message={toast.message} tone={toast.tone} />}
    </div>
  );
}
