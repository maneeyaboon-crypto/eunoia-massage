"use client";

import { useShop } from "./ShopProvider";
import { EVENT_LABEL, EVENT_TONE } from "@/lib/status";
import { hhmm } from "@/lib/format";
import { EmptyState } from "./ui";

export default function ActivityPanel({ limit = 25 }: { limit?: number }) {
  const { events, therapists } = useShop();
  const rows = events.slice(0, limit);

  return (
    <section className="card">
      <div className="border-b border-sand-200 px-4 py-3">
        <p className="section-title">ไทม์ไลน์วันนี้</p>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="ยังไม่มีกิจกรรมวันนี้" />
      ) : (
        <ol className="max-h-[420px] divide-y divide-sand-100 overflow-y-auto">
          {rows.map((e) => {
            const name = therapists.find((t) => t.id === e.therapist_id)?.name;
            return (
              <li key={e.id} className="flex items-start gap-3 px-4 py-2.5">
                <span className="w-11 shrink-0 pt-0.5 font-mono text-xs tabular-nums text-ink-400">
                  {hhmm(e.at)}
                </span>
                <span className="min-w-0">
                  <span
                    className={`text-sm font-semibold ${EVENT_TONE[e.event_type] ?? "text-ink-600"}`}
                  >
                    {name ? `${name} — ` : ""}
                    {EVENT_LABEL[e.event_type] ?? e.event_type}
                  </span>
                  {e.detail && <span className="block text-xs text-ink-400">{e.detail}</span>}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
