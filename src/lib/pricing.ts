import type { Service, Therapist } from "./types";

/**
 * Default therapist pay for one job.
 * Priority: therapist-specific override → service default.
 * (Shop rule of thumb: 30 min = ฿100, 60 min standard = ฿150,
 *  ฿500/hour premium services = ฿180 — all stored on the service row
 *  so the Owner can change them in Settings without touching code.)
 */
export function defaultPayFor(
  service: Pick<Service, "duration_min" | "default_therapist_pay">,
  therapist?: Pick<Therapist, "pay_override_30" | "pay_override_60"> | null,
): number {
  if (therapist) {
    if (service.duration_min <= 30 && therapist.pay_override_30 != null) {
      return Number(therapist.pay_override_30);
    }
    if (service.duration_min > 30 && therapist.pay_override_60 != null) {
      return Number(therapist.pay_override_60);
    }
  }
  return Number(service.default_therapist_pay ?? 0);
}

export interface QuoteInput {
  service: Service;
  therapist?: Therapist | null;
  customerCount: number;
}

export interface Quote {
  originalPrice: number;
  suggestedFinalPrice: number;
  defaultTherapistPay: number;
  durationMin: number;
}

export function quote({ service, therapist, customerCount }: QuoteInput): Quote {
  const count = Math.max(1, customerCount || 1);
  const unit = Number(service.price ?? 0);
  const pay = defaultPayFor(service, therapist);
  return {
    originalPrice: unit * count,
    suggestedFinalPrice: unit * count,
    defaultTherapistPay: pay * count,
    durationMin: service.duration_min,
  };
}

export function discountOf(originalPrice: number, finalPrice: number): number {
  return Math.max(0, Number(originalPrice || 0) - Number(finalPrice || 0));
}

export function shopRevenue(finalPrice: number, therapistPay: number): number {
  return Number(finalPrice || 0) - Number(therapistPay || 0);
}

/** ชื่อบริการที่แสดงให้ผู้ใช้เห็น — ใช้ชื่อไทยเป็นหลัก */
export function serviceLabel(s: Pick<Service, "name_en" | "name_th">): string {
  return s.name_th || s.name_en;
}
