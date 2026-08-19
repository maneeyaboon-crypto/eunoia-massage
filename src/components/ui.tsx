"use client";

import { useEffect, useRef } from "react";
import { STATUS } from "@/lib/status";
import type { DerivedStatus } from "@/lib/types";

export function StatusPill({
  status,
  remainingMin,
  size = "md",
}: {
  status: DerivedStatus;
  remainingMin?: number | null;
  size?: "sm" | "md";
}) {
  const meta = STATUS[status];
  const showTime =
    remainingMin != null && (status === "busy" || status === "finishing_soon" || status === "urgent");
  return (
    <span className={`pill ${meta.badge} ${size === "sm" ? "text-[10px]" : ""}`}>
      <span aria-hidden>{meta.dot}</span>
      <span>{meta.labelTh}</span>
      {showTime && <span className="tabular-nums">· {remainingMin} น.</span>}
    </span>
  );
}

export function StatCard({
  label,
  value,
  sub,
  tone = "default",
  className = "",
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "default" | "good" | "warn" | "bad" | "accent";
  className?: string;
}) {
  const toneCls =
    tone === "good"
      ? "text-emerald-600"
      : tone === "warn"
        ? "text-orange-600"
        : tone === "bad"
          ? "text-red-600"
          : tone === "accent"
            ? "text-jade-700"
            : "text-ink-800";
  return (
    <div className={`card card-pad ${className}`}>
      <p className="stat-label">{label}</p>
      <p className={`stat-value ${toneCls}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink-400">{sub}</p>}
    </div>
  );
}

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div
        className="absolute inset-0 bg-ink-800/40 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        className={`relative ml-auto flex h-full w-full flex-col bg-sand-50 shadow-lift ${
          wide ? "sm:max-w-3xl" : "sm:max-w-xl"
        }`}
      >
        <header className="flex items-start justify-between gap-4 border-b border-sand-200 bg-white px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-ink-800">{title}</h2>
            {subtitle && <p className="mt-0.5 text-sm text-ink-400">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="btn-ghost btn-sm shrink-0" aria-label="ปิด">
            ✕ ปิด
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer && (
          <footer className="border-t border-sand-200 bg-white px-5 py-4">{footer}</footer>
        )}
      </div>
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink-800/40 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-lift"
      >
        <header className="border-b border-sand-200 px-5 py-4">
          <h2 className="text-lg font-bold text-ink-800">{title}</h2>
        </header>
        <div className="max-h-[65vh] overflow-y-auto px-5 py-5">{children}</div>
        {footer && <footer className="border-t border-sand-200 bg-sand-50 px-5 py-4">{footer}</footer>}
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, hint }: { icon: string; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      <span className="text-3xl opacity-40" aria-hidden>
        {icon}
      </span>
      <p className="text-sm font-medium text-ink-500">{title}</p>
      {hint && <p className="max-w-xs text-xs text-ink-400">{hint}</p>}
    </div>
  );
}

export function Toast({ message, tone }: { message: string; tone: "ok" | "err" }) {
  return (
    <div
      className={`fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-xl px-5 py-3 text-sm font-semibold shadow-lift ${
        tone === "ok" ? "bg-jade-700 text-white" : "bg-red-600 text-white"
      }`}
      role="status"
    >
      {message}
    </div>
  );
}

export function SegButtons<T extends string>({
  value,
  options,
  onChange,
  className = "",
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
            value === o.value
              ? "bg-jade-600 text-white shadow-card"
              : "bg-white text-ink-600 ring-1 ring-sand-300 hover:bg-sand-50"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
