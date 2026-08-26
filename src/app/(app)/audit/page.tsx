"use client";

import { useCallback, useEffect, useState } from "react";
import { useShop } from "@/components/ShopProvider";
import { supabaseBrowser } from "@/lib/supabase/client";
import { EmptyState } from "@/components/ui";
import { shortDate } from "@/lib/format";
import type { AuditLogRow } from "@/lib/types";

const TABLE_LABEL: Record<string, string> = {
  massage_sessions: "รายการนวด",
  services: "บริการ",
  therapists: "หมอนวด",
  session_extensions: "ต่อเวลา",
};

const FIELD_LABEL: Record<string, string> = {
  final_price: "ราคาขายจริง",
  original_price: "ราคาตั้ง",
  actual_therapist_pay: "ค่าแรงหมอนวด (จริง)",
  default_therapist_pay: "ค่าแรงหมอนวด (ค่าเริ่มต้น)",
  service_id: "บริการ",
  service_name_en: "ชื่อบริการ",
  therapist_id: "หมอนวด",
  start_at: "เวลาเริ่ม",
  expected_finish_at: "เวลาเสร็จ (คาด)",
  finished_at: "เวลาเสร็จจริง",
  duration_min: "ระยะเวลา",
  status: "สถานะ",
  payment_method: "ช่องทางชำระ",
  void_reason: "เหตุผล Void",
  price: "ราคา",
  duration_min_service: "ระยะเวลาบริการ",
  is_active: "เปิด/ปิดใช้งาน",
  name: "ชื่อ",
  name_en: "ชื่อ (EN)",
  name_th: "ชื่อ (TH)",
  customer_name: "ชื่อลูกค้า",
  note: "โน้ต",
};

export default function AuditPage() {
  const { isOwner } = useShop();
  const supabase = supabaseBrowser();
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [table, setTable] = useState("");
  const [action, setAction] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase.from("audit_logs").select("*").order("at", { ascending: false }).limit(500);
    if (table) q = q.eq("table_name", table);
    if (action) q = q.eq("action", action);
    const { data } = await q;
    setRows((data ?? []) as AuditLogRow[]);
    setLoading(false);
  }, [supabase, table, action]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!isOwner) {
    return (
      <div className="card card-pad">
        <p className="font-semibold text-ink-800">เฉพาะเจ้าของร้านเท่านั้น</p>
        <p className="mt-1 text-sm text-ink-500">บันทึกการแก้ไขเปิดให้เฉพาะบัญชีเจ้าของร้าน</p>
      </div>
    );
  }

  function short(v: string | null): string {
    if (v == null) return "—";
    if (v.length > 90) return v.slice(0, 90) + "…";
    return v;
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-ink-800">บันทึกการแก้ไข</h1>
        <p className="mt-1 text-sm text-ink-400">
          ทุกการแก้ไขราคา ค่าแรง บริการ หมอนวด และรายการนวด — ใคร แก้อะไร ค่าเดิม ค่าใหม่ เมื่อไหร่
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <select className="input max-w-xs" value={table} onChange={(e) => setTable(e.target.value)}>
          <option value="">ทุกตาราง</option>
          {Object.entries(TABLE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select className="input max-w-xs" value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">ทุกการกระทำ</option>
          <option value="INSERT">สร้างใหม่</option>
          <option value="UPDATE">แก้ไข</option>
          <option value="DELETE">ลบ</option>
        </select>
      </div>

      <section className="card overflow-x-auto">
        {loading ? (
          <EmptyState title="กำลังโหลด…" />
        ) : rows.length === 0 ? (
          <EmptyState title="ยังไม่มีบันทึกการแก้ไข" />
        ) : (
          <table className="w-full min-w-[900px]">
            <thead className="border-b border-sand-200 bg-sand-50">
              <tr>
                <th className="table-th">เวลา</th>
                <th className="table-th">ผู้แก้ไข</th>
                <th className="table-th">ตาราง</th>
                <th className="table-th">การกระทำ</th>
                <th className="table-th">ฟิลด์</th>
                <th className="table-th">ค่าเดิม</th>
                <th className="table-th">ค่าใหม่</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sand-100">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="table-td text-xs">
                    {shortDate(r.at)}{" "}
                    <span className="text-ink-400">
                      {new Date(r.at).toLocaleTimeString("en-GB", {
                        timeZone: "Asia/Bangkok",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </td>
                  <td className="table-td text-xs">{r.actor_email ?? "ระบบ"}</td>
                  <td className="table-td">{TABLE_LABEL[r.table_name] ?? r.table_name}</td>
                  <td className="table-td">
                    <span
                      className={`pill ${
                        r.action === "UPDATE"
                          ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
                          : r.action === "INSERT"
                            ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                            : "bg-red-50 text-red-700 ring-1 ring-red-200"
                      }`}
                    >
                      {r.action === "UPDATE" ? "แก้ไข" : r.action === "INSERT" ? "สร้างใหม่" : "ลบ"}
                    </span>
                  </td>
                  <td className="table-td font-medium">
                    {r.field_name ? (FIELD_LABEL[r.field_name] ?? r.field_name) : "—"}
                  </td>
                  <td className="table-td max-w-[240px] truncate text-xs text-ink-500">
                    {short(r.old_value)}
                  </td>
                  <td className="table-td max-w-[240px] truncate text-xs font-medium text-ink-700">
                    {short(r.new_value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
