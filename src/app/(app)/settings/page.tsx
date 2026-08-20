"use client";

import { useState } from "react";
import { useShop } from "@/components/ShopProvider";
import GeneralSettings from "@/components/settings/GeneralSettings";
import ServicesSettings from "@/components/settings/ServicesSettings";
import SheetsSettings from "@/components/settings/SheetsSettings";
import TherapistsSettings from "@/components/settings/TherapistsSettings";
import UsersSettings from "@/components/settings/UsersSettings";
import { SegButtons } from "@/components/ui";

type Tab = "general" | "services" | "therapists" | "users" | "sheets";

export default function SettingsPage() {
  const { isOwner } = useShop();
  const [tab, setTab] = useState<Tab>(isOwner ? "general" : "therapists");

  // พนักงานหน้าร้านเข้าได้เฉพาะแท็บ "หมอนวด" — เพิ่มชื่อหมอใหม่ได้เอง
  // ราคา ค่าแรง ผู้ใช้งาน และ Google Sheets ยังเป็นของเจ้าของร้านเท่านั้น
  if (!isOwner) {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-ink-800">หมอนวด</h1>
          <p className="mt-1 text-sm text-ink-400">
            เพิ่มชื่อหมอนวดใหม่ หรือแก้ข้อมูลได้ที่นี่ — แล้วไปลงคิวที่หน้า &quot;คิววันนี้&quot;
          </p>
        </div>
        <TherapistsSettings />
        <p className="rounded-xl bg-sand-50 px-4 py-3 text-xs leading-relaxed text-ink-400 ring-1 ring-sand-300">
          หน้าตั้งค่าราคา ค่าแรง ผู้ใช้งาน และ Google Sheets เปิดให้เฉพาะบัญชีเจ้าของร้าน
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-ink-800">ตั้งค่าระบบ</h1>
        <p className="mt-1 text-sm text-ink-400">
          แก้ราคา ระยะเวลา ค่าแรง และข้อมูลหมอนวดได้ที่นี่ — ไม่ต้องแก้โค้ด
        </p>
      </div>

      <SegButtons
        value={tab}
        onChange={setTab}
        options={[
          { value: "general", label: "ทั่วไป" },
          { value: "services", label: "บริการ" },
          { value: "therapists", label: "หมอนวด" },
          { value: "users", label: "ผู้ใช้งาน" },
          { value: "sheets", label: "Google Sheets" },
        ]}
      />

      {tab === "general" && <GeneralSettings />}
      {tab === "services" && <ServicesSettings />}
      {tab === "therapists" && <TherapistsSettings />}
      {tab === "users" && <UsersSettings />}
      {tab === "sheets" && <SheetsSettings />}
    </div>
  );
}
