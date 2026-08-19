"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function LoginForm() {
  const supabase = supabaseBrowser();
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } },
        });
        if (error) throw error;
        const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
        if (signInErr) {
          setInfo("สร้างบัญชีแล้ว — กรุณายืนยันอีเมลก่อนเข้าใช้งาน");
          setMode("signin");
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      router.replace(params.get("next") || "/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "เข้าสู่ระบบไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card card-pad space-y-4">
      <div className="flex rounded-xl bg-sand-100 p-1">
        {(["signin", "signup"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              setError(null);
            }}
            className={`flex-1 rounded-lg py-2.5 text-sm font-semibold transition ${
              mode === m ? "bg-white text-ink-800 shadow-sm" : "text-ink-400"
            }`}
          >
            {m === "signin" ? "เข้าสู่ระบบ" : "สร้างบัญชี"}
          </button>
        ))}
      </div>

      {mode === "signup" && (
        <div>
          <label className="label">ชื่อ-นามสกุล</label>
          <input
            className="input"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="เช่น ปราว"
            autoComplete="name"
          />
        </div>
      )}

      <div>
        <label className="label">อีเมล</label>
        <input
          className="input"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          inputMode="email"
        />
      </div>

      <div>
        <label className="label">รหัสผ่าน</label>
        <input
          className="input"
          type="password"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
        />
      </div>

      {error && (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
          {error}
        </p>
      )}
      {info && (
        <p className="rounded-xl bg-jade-50 px-4 py-3 text-sm text-jade-700 ring-1 ring-jade-200">
          {info}
        </p>
      )}

      <button className="btn-primary btn-lg w-full" disabled={busy}>
        {busy ? "กำลังดำเนินการ…" : mode === "signin" ? "เข้าสู่ระบบ" : "สร้างบัญชี"}
      </button>

      {mode === "signup" && (
        <p className="text-center text-xs leading-relaxed text-ink-400">
          บัญชีแรกที่สมัครจะเป็น <strong>เจ้าของร้าน</strong> (เห็นทุกอย่าง)
          <br />
          บัญชีถัดไปจะเป็น <strong>พนักงานหน้าร้าน</strong>
        </p>
      )}
    </form>
  );
}
