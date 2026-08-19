import type { MassageSession } from "./types";

export interface TherapistTotals {
  jobs: number;
  pay: number;
  sales: number;
  minutes: number;
  requests: number;
}

const EMPTY: TherapistTotals = { jobs: 0, pay: 0, sales: 0, minutes: 0, requests: 0 };

/** Per-therapist totals for a set of sessions (voided rows excluded). */
export function totalsByTherapist(sessions: MassageSession[]): Map<string, TherapistTotals> {
  const map = new Map<string, TherapistTotals>();
  for (const s of sessions) {
    if (s.status === "voided") continue;
    const cur = map.get(s.therapist_id) ?? { ...EMPTY };
    cur.jobs += 1;
    cur.pay += Number(s.actual_therapist_pay);
    cur.sales += Number(s.final_price);
    cur.minutes += Number(s.duration_min);
    if (s.is_customer_request) cur.requests += 1;
    map.set(s.therapist_id, cur);
  }
  return map;
}

export function totalsFor(
  map: Map<string, TherapistTotals>,
  therapistId: string,
): TherapistTotals {
  return map.get(therapistId) ?? { ...EMPTY };
}

export interface DayTotals {
  jobs: number;
  customers: number;
  originalValue: number;
  grossSales: number;
  discount: number;
  wages: number;
  netRevenue: number;
  cash: number;
  qr: number;
  card: number;
  other: number;
  unpaid: number;
  activeCount: number;
  activeCustomers: number;
}

/** Money rollup. Only FINISHED sessions count as sales; active ones are shown
 *  separately so the day's takings are never overstated. */
export function dayTotals(sessions: MassageSession[]): DayTotals {
  const t: DayTotals = {
    jobs: 0,
    customers: 0,
    originalValue: 0,
    grossSales: 0,
    discount: 0,
    wages: 0,
    netRevenue: 0,
    cash: 0,
    qr: 0,
    card: 0,
    other: 0,
    unpaid: 0,
    activeCount: 0,
    activeCustomers: 0,
  };

  for (const s of sessions) {
    if (s.status === "voided") continue;
    if (s.status === "active") {
      t.activeCount += 1;
      t.activeCustomers += Number(s.customer_count);
      continue;
    }
    t.jobs += 1;
    t.customers += Number(s.customer_count);
    t.originalValue += Number(s.original_price);
    t.grossSales += Number(s.final_price);
    t.discount += Number(s.discount);
    t.wages += Number(s.actual_therapist_pay);
    t.netRevenue += Number(s.shop_revenue);
    switch (s.payment_method) {
      case "cash":
        t.cash += Number(s.final_price);
        break;
      case "qr":
        t.qr += Number(s.final_price);
        break;
      case "card":
        t.card += Number(s.final_price);
        break;
      case "other":
        t.other += Number(s.final_price);
        break;
      default:
        t.unpaid += Number(s.final_price);
    }
  }
  return t;
}
