"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { bangkokToday } from "@/lib/format";
import {
  computeRotation,
  planAssignments,
  type ActiveSessionLite,
  type AssignmentPlan,
  type RotationResult,
} from "@/lib/queue";
import type {
  MassageSession,
  Profile,
  ShopSettings,
  QueueEvent,
  QueueRow,
  Service,
  Therapist,
  WaitingCustomer,
} from "@/lib/types";

interface ShopState {
  profile: Profile | null;
  isOwner: boolean;
  workDate: string;
  now: Date;
  loading: boolean;
  error: string | null;

  therapists: Therapist[];
  services: Service[];
  queue: QueueRow[];
  activeSessions: MassageSession[];
  todaySessions: MassageSession[];
  waiting: WaitingCustomer[];
  events: QueueEvent[];
  lastAssignedTherapistId: string | null;
  dayClosed: boolean;

  rotation: RotationResult;
  /** ตั้งค่าของร้าน (ปิดงานอัตโนมัติ ฯลฯ) */
  settings: ShopSettings;
  /** งานที่ปิดแล้วแต่ยังไม่ได้ระบุช่องทางชำระ = ยังไม่ได้เก็บเงิน */
  unpaid: MassageSession[];
  /** หมอวิ่งที่ยังไม่ได้ลงคิววันนี้ — เรียกเข้ามาได้เมื่อคนไม่พอ */
  runnerPool: Therapist[];
  /** วางแผนจ่ายคิวให้ลูกค้าหลายคนพร้อมกัน */
  planFor: (count: number) => AssignmentPlan;
  refresh: () => Promise<void>;
}

const ShopContext = createContext<ShopState | null>(null);

export function useShop(): ShopState {
  const ctx = useContext(ShopContext);
  if (!ctx) throw new Error("useShop must be used inside <ShopProvider>");
  return ctx;
}

export function ShopProvider({
  profile,
  children,
}: {
  profile: Profile | null;
  children: React.ReactNode;
}) {
  const supabase = supabaseBrowser();
  const [workDate, setWorkDate] = useState(() => bangkokToday());
  const [now, setNow] = useState(() => new Date());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [therapists, setTherapists] = useState<Therapist[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [todaySessions, setTodaySessions] = useState<MassageSession[]>([]);
  const [waiting, setWaiting] = useState<WaitingCustomer[]>([]);
  const [events, setEvents] = useState<QueueEvent[]>([]);
  const [lastAssignedTherapistId, setLastAssigned] = useState<string | null>(null);
  const [dayClosed, setDayClosed] = useState(false);
  const [settings, setSettings] = useState<ShopSettings>({
    auto_finish_enabled: true,
    auto_finish_grace_min: 0,
    sheets_webapp_url: null,
    sheets_secret: null,
    sheets_auto_on_close: true,
    sheets_last_sync_at: null,
    sheets_last_status: null,
    sheets_last_message: null,
    sheets_last_date: null,
  });

  // 1-second tick drives every countdown and the wall clock.
  useEffect(() => {
    const id = setInterval(() => {
      const d = new Date();
      setNow(d);
      const today = bangkokToday(d);
      setWorkDate((prev) => (prev === today ? prev : today));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [t, s, q, sess, w, ev, st, dc, cfg] = await Promise.all([
        supabase.from("therapists").select("*").order("name"),
        supabase.from("services").select("*").order("sort_order").order("name_en"),
        supabase
          .from("daily_queue")
          .select("*, therapist:therapists(*)")
          .eq("work_date", workDate)
          .order("position"),
        supabase
          .from("massage_sessions")
          .select("*")
          .eq("work_date", workDate)
          .order("start_at", { ascending: false }),
        supabase
          .from("waiting_customers")
          .select("*")
          .eq("work_date", workDate)
          .eq("status", "waiting")
          .order("arrival_at"),
        supabase
          .from("queue_events")
          .select("*")
          .eq("work_date", workDate)
          .order("at", { ascending: false })
          .limit(80),
        supabase.from("queue_state").select("*").eq("work_date", workDate).maybeSingle(),
        supabase.from("daily_closings").select("work_date").eq("work_date", workDate).maybeSingle(),
        supabase.from("shop_settings").select("*").maybeSingle(),
      ]);

      const firstErr = [t, s, q, sess, w, ev, st, dc].find((r) => r.error)?.error;
      if (firstErr) throw firstErr;

      setTherapists((t.data ?? []) as Therapist[]);
      setServices((s.data ?? []) as Service[]);
      setQueue((q.data ?? []) as unknown as QueueRow[]);
      setTodaySessions((sess.data ?? []) as MassageSession[]);
      setWaiting((w.data ?? []) as WaitingCustomer[]);
      setEvents((ev.data ?? []) as QueueEvent[]);
      setLastAssigned(
        (st.data as { last_assigned_therapist_id: string | null } | null)
          ?.last_assigned_therapist_id ?? null,
      );
      setDayClosed(Boolean(dc.data));
      if (cfg.data) setSettings(cfg.data as ShopSettings);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดข้อมูลไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [supabase, workDate]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // ปิดงานอัตโนมัติเมื่อครบเวลา — เครื่องไหนเปิดหน้าอยู่ก็ช่วยปิดให้
  // ฟังก์ชันฝั่งฐานข้อมูลปลอดภัยถ้าเรียกซ้ำ และเช็กสวิตช์ให้เองอยู่แล้ว
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (stop) return;
      const { data } = await supabase.rpc("auto_finish_due");
      if (!stop && typeof data === "number" && data > 0) await refresh();
    };
    void tick();
    const id = setInterval(() => void tick(), 20000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [supabase, refresh]);

  // Realtime: any change to the operational tables triggers one debounced refetch.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const bump = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void refresh(), 250);
    };

    const channel = supabase.channel("eunoia-shop");
    for (const table of [
      "massage_sessions",
      "daily_queue",
      "queue_state",
      "queue_events",
      "waiting_customers",
      "therapists",
      "services",
      "session_extensions",
      "daily_closings",
    ]) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, bump);
    }
    channel.subscribe();

    return () => {
      if (timer.current) clearTimeout(timer.current);
      void supabase.removeChannel(channel);
    };
  }, [supabase, refresh]);

  const activeSessions = useMemo(
    () => todaySessions.filter((s) => s.status === "active"),
    [todaySessions],
  );

  const queueInputs = useMemo(
    () =>
      queue.map((row) => ({
        therapist_id: row.therapist_id,
        name: row.therapist?.name ?? "—",
        nickname: row.therapist?.nickname ?? null,
        position: row.position,
        status: row.status,
      })),
    [queue],
  );

  const activeLite = useMemo<ActiveSessionLite[]>(
    () =>
      activeSessions.map((s) => ({
        id: s.id,
        therapist_id: s.therapist_id,
        expected_finish_at: s.expected_finish_at,
        service_name_en: s.service_name_en,
        service_name_th: s.service_name_th,
        customer_name: s.customer_name,
        final_price: Number(s.final_price),
        start_at: s.start_at,
        duration_min: s.duration_min,
      })),
    [activeSessions],
  );

  const rotation = useMemo<RotationResult>(
    () => computeRotation(queueInputs, activeLite, lastAssignedTherapistId, now),
    [queueInputs, activeLite, lastAssignedTherapistId, now],
  );

  const planFor = useCallback(
    (count: number) =>
      planAssignments(queueInputs, activeLite, lastAssignedTherapistId, count, now),
    [queueInputs, activeLite, lastAssignedTherapistId, now],
  );

  const unpaid = useMemo(
    () => todaySessions.filter((s) => s.status === "finished" && !s.payment_method),
    [todaySessions],
  );

  /** หมอวิ่งในระบบที่ยังไม่ได้ลงคิววันนี้ */
  const runnerPool = useMemo(() => {
    const inQueue = new Set(queue.map((q) => q.therapist_id));
    return therapists.filter((t) => t.is_runner && t.is_active && !inQueue.has(t.id));
  }, [therapists, queue]);

  const value: ShopState = {
    profile,
    isOwner: profile?.role === "owner",
    workDate,
    now,
    loading,
    error,
    therapists,
    services,
    queue,
    activeSessions,
    todaySessions,
    waiting,
    events,
    lastAssignedTherapistId,
    dayClosed,
    rotation,
    settings,
    unpaid,
    runnerPool,
    planFor,
    refresh,
  };

  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}
