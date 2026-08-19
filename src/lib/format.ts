export const TZ = "Asia/Bangkok";

export function baht(n: number | null | undefined, opts?: { decimals?: boolean }): string {
  const v = Number(n ?? 0);
  return (
    "฿" +
    v.toLocaleString("en-US", {
      minimumFractionDigits: opts?.decimals ? 2 : 0,
      maximumFractionDigits: opts?.decimals ? 2 : 0,
    })
  );
}

/** HH:mm in Bangkok time. */
export function hhmm(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TZ,
  });
}

export function thaiDateLong(d: Date = new Date()): string {
  return d.toLocaleDateString("th-TH", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: TZ,
  });
}

export function shortDate(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: TZ,
  });
}

/** The Bangkok calendar date as YYYY-MM-DD. This is the system's "work_date". */
export function bangkokToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return parts; // en-CA gives YYYY-MM-DD
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function startOfWeek(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  const dow = d.getUTCDay(); // 0 = Sunday
  const diff = dow === 0 ? 6 : dow - 1; // week starts Monday
  return addDays(dateStr, -diff);
}

export function startOfMonth(dateStr: string): string {
  return dateStr.slice(0, 7) + "-01";
}

/** "HH:mm" typed by Admin + a work date -> ISO timestamp in Bangkok time. */
export function bangkokTimeToIso(workDate: string, time: string): string {
  // Bangkok is a fixed UTC+7 offset (no DST), so this is exact.
  return new Date(`${workDate}T${time}:00+07:00`).toISOString();
}

/** Current Bangkok wall-clock time as "HH:mm", for pre-filling time inputs. */
export function nowHHmm(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
}

export function minutesLabel(m: number | null): string {
  if (m === null) return "—";
  if (m <= 0) return "หมดเวลา";
  if (m < 60) return `${m} นาที`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h} ชม. ${rem} นาที` : `${h} ชม.`;
}

export function pct(part: number, whole: number): string {
  if (!whole) return "0.00%";
  return ((part / whole) * 100).toFixed(2) + "%";
}
