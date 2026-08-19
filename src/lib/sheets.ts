/**
 * ส่งรายละเอียดของวันเข้า Google Sheets
 * ยิงผ่าน /api/sheets (ฝั่งเซิร์ฟเวอร์) เพราะ Google Apps Script
 * ไม่อนุญาตให้เบราว์เซอร์ยิงตรงข้ามโดเมน
 */

export type SheetsPushResult = {
  ok: boolean;
  rows?: number;
  work_date?: string;
  message?: string;
  error?: string;
};

export async function pushDayToSheets(
  workDate: string,
  triggerBy: "manual" | "close_day" = "manual",
): Promise<SheetsPushResult> {
  try {
    const res = await fetch("/api/sheets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ work_date: workDate, trigger_by: triggerBy }),
    });
    return (await res.json()) as SheetsPushResult;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "ส่งข้อมูลไม่สำเร็จ" };
  }
}

export async function testSheetsConnection(): Promise<SheetsPushResult> {
  try {
    const res = await fetch("/api/sheets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ test: true }),
    });
    return (await res.json()) as SheetsPushResult;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "ทดสอบไม่สำเร็จ" };
  }
}
