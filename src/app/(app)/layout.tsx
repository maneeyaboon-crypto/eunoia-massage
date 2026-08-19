import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { ShopProvider } from "@/components/ShopProvider";
import AppShell from "@/components/AppShell";
import type { Profile } from "@/lib/types";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (profile && profile.is_active === false) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="card card-pad max-w-md text-center">
          <p className="text-lg font-bold text-ink-800">บัญชีนี้ถูกปิดใช้งาน</p>
          <p className="mt-2 text-sm text-ink-500">กรุณาติดต่อเจ้าของร้านเพื่อเปิดใช้งานอีกครั้ง</p>
        </div>
      </main>
    );
  }

  return (
    <ShopProvider profile={(profile as Profile) ?? null}>
      <AppShell>{children}</AppShell>
    </ShopProvider>
  );
}
