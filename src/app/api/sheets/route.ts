import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  work_date?: string;
  test?: boolean;
  trigger_by?: "manual" | "close_day" | "test";
};

function fail(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(req: Request) {
  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    body = {};
  }

  const supabase = await supabaseServer();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("กรุณาเข้าสู่ระบบก่อน", 401);

  const { data: settings, error: settingsError } = await supabase
    .from("shop_settings")
    .select("sheets_webapp_url, sheets_secret")
    .eq("id", true)
    .single();

  if (settingsError) return fail("อ่านการตั้งค่าไม่สำเร็จ: " + settingsError.message, 500);

  const url = (settings?.sheets_webapp_url ?? "").trim();
  const secret = (settings?.sheets_secret ?? "").trim();

  if (!url) return fail("ยังไม่ได้ตั้งค่าลิงก์ Google Sheets ในหน้าตั้งค่าระบบ");
  if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) {
    return fail("ลิงก์ไม่ถูกต้อง — ต้องเป็นลิงก์ Web App ของ Google Apps Script ที่ลงท้ายด้วย /exec");
  }

  // โหมดทดสอบการเชื่อมต่อ — ไม่ดึงข้อมูลจริง ไม่เขียนอะไรลงชีต
  if (body.test) {
    const result = await postToSheets(url, { secret, test: true });
    if (!result.ok) return fail(result.error, 502);
    return NextResponse.json({ ok: true, message: "เชื่อมต่อ Google Sheets สำเร็จ" });
  }

  const workDate = body.work_date;
  const triggerBy = body.trigger_by ?? "manual";

  const { data: payload, error: exportError } = await supabase.rpc("day_export", {
    p_work_date: workDate,
  });

  if (exportError) return fail("ดึงข้อมูลของวันไม่สำเร็จ: " + exportError.message, 500);

  const dateForLog =
    (payload as { work_date?: string } | null)?.work_date ?? workDate ?? null;

  const result = await postToSheets(url, { secret, payload });

  if (!result.ok) {
    if (dateForLog) {
      await supabase.rpc("log_sheets_sync", {
        p_work_date: dateForLog,
        p_status: "error",
        p_message: result.error.slice(0, 500),
        p_rows: 0,
        p_trigger_by: triggerBy,
      });
    }
    return fail(result.error, 502);
  }

  const rows = Number(result.data?.rows ?? 0);

  if (dateForLog) {
    await supabase.rpc("log_sheets_sync", {
      p_work_date: dateForLog,
      p_status: "ok",
      p_message: `ส่งสำเร็จ ${rows} รายการ`,
      p_rows: rows,
      p_trigger_by: triggerBy,
    });
  }

  return NextResponse.json({ ok: true, work_date: dateForLog, rows });
}

type SheetsResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string };

async function postToSheets(url: string, body: unknown): Promise<SheetsResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: "ติดต่อ Google Sheets ไม่ได้: " + msg };
  }

  const text = await res.text();

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // Apps Script ตอบกลับเป็นหน้า HTML = ปกติแล้วแปลว่าตอนกด Deploy
    // ไม่ได้เลือก "ทุกคน (Anyone)" ในช่อง Who has access
    return {
      ok: false,
      error:
        'Google ตอบกลับมาเป็นหน้าเว็บแทนข้อมูล — ให้กลับไปที่ Apps Script → ทำให้ใช้งานได้ (Deploy) ' +
        'แล้วตั้งค่า "ผู้ที่มีสิทธิ์เข้าถึง" เป็น "ทุกคน (Anyone)" และใช้ลิงก์ที่ลงท้ายด้วย /exec',
    };
  }

  if (data.ok !== true) {
    return { ok: false, error: String(data.error ?? "Google Sheets ปฏิเสธข้อมูล") };
  }

  return { ok: true, data };
}
