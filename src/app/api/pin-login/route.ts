import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * เข้าระบบด้วย PIN 6 หลัก
 *
 * ทำงานทั้งหมดที่ฝั่งเซิร์ฟเวอร์:
 *   1. รับ PIN จากหน้าเว็บ
 *   2. ให้ฐานข้อมูลตรวจว่า PIN ตรงกับบัญชีไหน (verify_login_pin — เก็บเป็น bcrypt hash)
 *   3. ถ้าตรง ออกตั๋วเข้าระบบให้บัญชีนั้น แล้วเซ็ตเป็นคุกกี้
 *
 * รหัสผ่านจริงของบัญชีไม่เคยถูกใช้และไม่เคยถูกส่งมาที่หน้าเว็บ
 * ตัวเลข PIN ไม่ถูกเก็บที่ไหนทั้งสิ้น เก็บแค่ลายนิ้วมือของมัน
 */

const DEVICE_COOKIE = "eunoia_device";

function fail(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    return fail(
      "ยังไม่ได้ตั้งค่าเข้าระบบด้วย PIN บนเซิร์ฟเวอร์ — ให้ใส่ค่า SUPABASE_SERVICE_ROLE_KEY ใน Vercel ก่อน แล้วกด Redeploy",
      500,
    );
  }

  let pin = "";
  try {
    const body = (await req.json()) as { pin?: unknown };
    pin = typeof body.pin === "string" ? body.pin.trim() : "";
  } catch {
    pin = "";
  }

  if (!/^[0-9]{6}$/.test(pin)) return fail("กรุณาใส่ PIN ตัวเลข 6 หลัก");

  // ชื่อเครื่อง — ใช้แยกว่าใครกรอกผิดถี่ ๆ จะได้ไม่ล็อกเครื่องอื่นไปด้วย
  const cookieStore = await cookies();
  let device = cookieStore.get(DEVICE_COOKIE)?.value ?? "";
  if (!/^[a-f0-9]{16,64}$/.test(device)) device = crypto.randomUUID().replace(/-/g, "");

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await admin.rpc("verify_login_pin", {
    p_pin: pin,
    p_client: device,
  });

  if (error) {
    // ข้อความล็อก "ใส่ PIN ผิดหลายครั้งเกินไป" ส่งกลับให้ผู้ใช้อ่านได้เลย
    const msg = error.message || "ตรวจ PIN ไม่สำเร็จ";
    const locked = msg.includes("ผิดหลายครั้ง");
    return fail(locked ? msg : "ตรวจ PIN ไม่สำเร็จ กรุณาลองใหม่", locked ? 429 : 500);
  }

  const match = Array.isArray(data) ? data[0] : null;
  if (!match?.email) {
    const res = fail("PIN ไม่ถูกต้อง", 401);
    res.cookies.set(DEVICE_COOKIE, device, {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
    return res;
  }

  // ออกตั๋วเข้าระบบให้บัญชีที่ผูกกับ PIN นี้ (ไม่ได้ส่งอีเมลออกไป)
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: match.email as string,
  });

  const tokenHash = link?.properties?.hashed_token;
  if (linkError || !tokenHash) {
    return fail("ออกตั๋วเข้าระบบไม่สำเร็จ: " + (linkError?.message ?? "ไม่ทราบสาเหตุ"), 500);
  }

  // แลกตั๋วเป็น session แล้วเก็บเป็นคุกกี้ — ครั้งต่อไปเปิดเว็บก็เข้าได้เลยไม่ต้องใส่ PIN ซ้ำ
  const supabase = await supabaseServer();
  const { error: otpError } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: "email",
  });

  if (otpError) return fail("เข้าระบบไม่สำเร็จ: " + otpError.message, 500);

  const res = NextResponse.json({
    ok: true,
    label: match.label ?? null,
    role: match.role ?? null,
  });
  res.cookies.set(DEVICE_COOKIE, device, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}
