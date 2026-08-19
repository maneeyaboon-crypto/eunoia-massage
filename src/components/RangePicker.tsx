"use client";

import { addDays, bangkokToday, startOfMonth, startOfWeek } from "@/lib/format";

export type RangeKey = "today" | "yesterday" | "week" | "month" | "custom";

export interface Range {
  key: RangeKey;
  from: string;
  to: string;
}

export function makeRange(key: RangeKey, from?: string, to?: string): Range {
  const today = bangkokToday();
  switch (key) {
    case "today":
      return { key, from: today, to: today };
    case "yesterday": {
      const y = addDays(today, -1);
      return { key, from: y, to: y };
    }
    case "week":
      return { key, from: startOfWeek(today), to: today };
    case "month":
      return { key, from: startOfMonth(today), to: today };
    case "custom":
      return { key, from: from ?? today, to: to ?? today };
  }
}

const LABELS: Array<{ key: RangeKey; label: string }> = [
  { key: "today", label: "วันนี้" },
  { key: "yesterday", label: "เมื่อวาน" },
  { key: "week", label: "สัปดาห์นี้" },
  { key: "month", label: "เดือนนี้" },
  { key: "custom", label: "กำหนดเอง" },
];

export default function RangePicker({
  range,
  onChange,
}: {
  range: Range;
  onChange: (r: Range) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {LABELS.map((l) => (
        <button
          key={l.key}
          onClick={() => onChange(makeRange(l.key, range.from, range.to))}
          className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
            range.key === l.key
              ? "bg-jade-600 text-white shadow-card"
              : "bg-white text-ink-600 ring-1 ring-sand-300 hover:bg-sand-50"
          }`}
        >
          {l.label}
        </button>
      ))}
      {range.key === "custom" && (
        <span className="flex items-center gap-2">
          <input
            type="date"
            className="h-11 rounded-xl bg-white px-3 text-sm ring-1 ring-sand-300"
            value={range.from}
            onChange={(e) => onChange({ ...range, from: e.target.value })}
          />
          <span className="text-ink-400">→</span>
          <input
            type="date"
            className="h-11 rounded-xl bg-white px-3 text-sm ring-1 ring-sand-300"
            value={range.to}
            onChange={(e) => onChange({ ...range, to: e.target.value })}
          />
        </span>
      )}
    </div>
  );
}
