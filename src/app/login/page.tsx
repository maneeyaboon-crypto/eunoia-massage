import { Suspense } from "react";
import LoginPanel from "./LoginPanel";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-sand-100 via-sand-50 to-jade-50 p-6">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-jade-600 text-2xl font-bold text-white shadow-lift">
            E
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-ink-800">EUNOIA</h1>
          <p className="mt-1 text-sm tracking-[0.28em] text-ink-400">MASSAGE</p>
        </div>

        <Suspense
          fallback={
            <div className="card card-pad text-center text-sm text-ink-400">กำลังโหลด…</div>
          }
        >
          <LoginPanel />
        </Suspense>
      </div>
    </main>
  );
}
