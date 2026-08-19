"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useShop } from "./ShopProvider";
import { supabaseBrowser } from "@/lib/supabase/client";
import { thaiDateLong } from "@/lib/format";
import { useState } from "react";

const NAV = [
  { href: "/", label: "หน้าร้าน", en: "Dashboard", icon: "🏠", ownerOnly: false },
  { href: "/queue", label: "คิววันนี้", en: "Queue", icon: "📋", ownerOnly: false },
  { href: "/history", label: "ประวัติ", en: "History", icon: "🧾", ownerOnly: false },
  { href: "/finance", label: "การเงิน", en: "Finance", icon: "📊", ownerOnly: true },
  { href: "/reports", label: "รายงาน / ปิดวัน", en: "Reports", icon: "🗂️", ownerOnly: true },
  { href: "/settings", label: "ตั้งค่า", en: "Settings", icon: "⚙️", ownerOnly: true },
  { href: "/audit", label: "บันทึกการแก้ไข", en: "Audit", icon: "🔍", ownerOnly: true },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { profile, isOwner, now, error } = useShop();
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  const clock = now.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Asia/Bangkok",
  });

  const items = NAV.filter((n) => !n.ownerOnly || isOwner);

  async function signOut() {
    await supabaseBrowser().auth.signOut();
    router.replace("/login");
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-sand-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1800px] items-center gap-4 px-4 py-3">
          <Link href="/" className="flex items-center gap-3 no-select">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-jade-600 text-lg font-bold text-white">
              E
            </span>
            <span className="hidden sm:block">
              <span className="block text-base font-bold leading-tight text-ink-800">EUNOIA</span>
              <span className="block text-[10px] tracking-[0.22em] text-ink-400">MASSAGE</span>
            </span>
          </Link>

          <div className="ml-auto flex items-center gap-4">
            <div className="text-right">
              <p className="font-mono text-xl font-bold leading-none tabular-nums text-ink-800 sm:text-2xl">
                {clock}
              </p>
              <p className="mt-0.5 text-[11px] text-ink-400">{thaiDateLong(now)}</p>
            </div>
            <div className="relative">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="flex h-11 w-11 items-center justify-center rounded-xl bg-sand-100 text-sm font-bold text-ink-600 ring-1 ring-sand-300"
                aria-label="เมนูผู้ใช้"
              >
                {(profile?.full_name || profile?.email || "?").slice(0, 1).toUpperCase()}
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 z-20 mt-2 w-60 overflow-hidden rounded-2xl bg-white shadow-lift ring-1 ring-sand-200">
                    <div className="border-b border-sand-200 px-4 py-3">
                      <p className="truncate text-sm font-semibold text-ink-800">
                        {profile?.full_name || profile?.email}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-400">
                        {isOwner ? "เจ้าของร้าน — เห็นทุกอย่าง" : "พนักงานหน้าร้าน"}
                      </p>
                    </div>
                    <button
                      onClick={signOut}
                      className="w-full px-4 py-3 text-left text-sm font-medium text-red-600 hover:bg-sand-50"
                    >
                      ออกจากระบบ
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <nav className="mx-auto max-w-[1800px] overflow-x-auto px-2 pb-2">
          <div className="flex gap-1">
            {items.map((n) => {
              const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={`flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                    active
                      ? "bg-jade-600 text-white shadow-card"
                      : "text-ink-500 hover:bg-sand-100"
                  }`}
                >
                  <span aria-hidden>{n.icon}</span>
                  <span>{n.label}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      </header>

      {error && (
        <div className="mx-auto max-w-[1800px] px-4 pt-3">
          <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
            {error}
          </p>
        </div>
      )}

      <main className="mx-auto max-w-[1800px] px-3 py-4 sm:px-4 sm:py-6">{children}</main>
    </div>
  );
}
