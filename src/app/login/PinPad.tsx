"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"] as const;

export default function PinPad({ onUseEmail }: { onUseEmail: () => void }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function press(k: string) {
    if (busy) return;
    setError(null);
    if (k === "clear") return setPin("");
    if (k === "back") return setPin((p) => p.slice(0, -1));
    setPin((p) => (p.length >= 6 ? p : p + k));
  }

  // พิมพ์จากคีย์บอร์ดก็ได้ เผื่อใช้บนคอม
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key >= "0" && e.key <= "9") press(e.key);
      else if (e.key === "Backspace") press("back");
      else if (e.key === "Escape") press("clear");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  useEffect(() => {
    if (pin.length !== 6 || busy) return;
    let cancelled = false;

    (async () => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/pin-login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pin }),
        });
        const json = (await res.json()) as { ok?: boolean; error?: string };
        if (cancelled) return;
        if (!res.ok || !json.ok) {
          setError(json.error || "PIN ไม่ถูกต้อง");
          setPin("");
          setBusy(false);
          return;
        }
        router.replace(params.get("next") || "/");
        router.refresh();
      } catch {
        if (cancelled) return;
        setError("ต่อเน็ตไม่ได้ กรุณาลองใหม่");
        setPin("");
        setBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  return (
    <div className="card card-pad space-y-6">
      <div className="text-center">
        <p className="text-sm font-semibold text-ink-500">ใส่ PIN 6 หลัก</p>
        <div className="mt-4 flex justify-center gap-3" aria-label={`ใส่แล้ว ${pin.length} หลัก`}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <span
              key={i}
              className={`h-4 w-4 rounded-full transition ${
                i < pin.length ? "bg-jade-600" : "bg-sand-200 ring-1 ring-sand-300"
              }`}
            />
          ))}
        </div>
      </div>

      {error && (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-center text-sm font-medium text-red-700 ring-1 ring-red-200">
          {error}
        </p>
      )}

      {busy && !error && (
        <p className="text-center text-sm font-medium text-jade-700">กำลังเข้าระบบ…</p>
      )}

      <div className="grid grid-cols-3 gap-3">
        {KEYS.map((k) => (
          <button
            key={k}
            type="button"
            disabled={busy}
            onClick={() => press(k)}
            className={`h-16 rounded-2xl text-2xl font-bold tabular-nums transition active:scale-95 disabled:opacity-40 ${
              k === "clear" || k === "back"
                ? "bg-sand-100 text-sm font-semibold text-ink-500 ring-1 ring-sand-300"
                : "bg-white text-ink-800 shadow-card ring-1 ring-sand-200 hover:bg-sand-50"
            }`}
          >
            {k === "clear" ? "ล้าง" : k === "back" ? "ลบ" : k}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={onUseEmail}
        className="w-full text-center text-xs font-semibold text-ink-400 underline"
      >
        เข้าด้วยอีเมลและรหัสผ่านแทน
      </button>
    </div>
  );
}
