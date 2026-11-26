import { CarpoolPlan, CarpoolPlanState } from '../carpool.models';
import { DocumentRequirement } from './carpool-signup.models';

/**
 * Screen logic for the sign-up status and Plans pages in the new look
 * (mockup 1f to 1i, Dev-Plan W13). Kept here, free of Angular, so it is tested on its own.
 */

/** Which status screen to show. "home" means: go to the carpool Home, nothing to show. */
export type StatusView = 'checking' | 'fix' | 'approved-no-plan' | 'approved-has-plan' | 'opens-soon' | 'home';

export function statusView(s: {
  approval: 'pending' | 'approved' | 'rejected';
  docs: DocumentRequirement[];
  carpoolOn: boolean;
  hasPlan: boolean;
  seenApproved: boolean;
}): StatusView {
  if (s.approval === 'approved') {
    if (!s.carpoolOn) return 'opens-soon';
    if (s.seenApproved) return 'home';
    return s.hasPlan ? 'approved-has-plan' : 'approved-no-plan';
  }
  const needsWork = s.docs.some((d) => d.document_id !== null && (d.status === 'missing' || d.status === 'rejected'));
  return needsWork || s.approval === 'rejected' ? 'fix' : 'checking';
}

export function docProgress(docs: DocumentRequirement[]): { approved: number; total: number; percent: number } {
  const real = docs.filter((d) => d.document_id !== null);
  const approved = real.filter((d) => d.status === 'approved').length;
  return { approved, total: real.length, percent: real.length ? Math.round((approved / real.length) * 100) : 0 };
}

/** Which Plans screen to show: none (1h), active (1h), ending soon (1i, amber), next plan waiting (1i). */
export type PlanView = 'none' | 'active' | 'ending' | 'waiting';

export function planView(state: CarpoolPlanState | null): PlanView {
  if (!state?.plan) return 'none';
  if (state.next_plan) return 'waiting';
  return state.ending_soon ? 'ending' : 'active';
}

/** Whole days left until `expiresAt`, counting a part day as a day. */
export function daysLeft(expiresAt: string | null, now: Date = new Date()): number {
  if (!expiresAt) return 0;
  const ms = new Date(expiresAt).getTime() - now.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / 86_400_000);
}

/** The ring is 201 long (r = 32); the offset hides the part already used. */
export function ringOffset(left: number, total: number): number {
  if (!total) return 201;
  const share = Math.max(0, Math.min(1, left / total));
  return Math.round(201 * (1 - share));
}

export function perDay(plan: CarpoolPlan): string {
  const v = plan.days_count ? plan.amount / plan.days_count : plan.amount;
  const text = Number.isInteger(v) ? String(v) : v.toFixed(2);
  return `₹${text} a day`;
}

/** The plan with the lowest price a day, marked "Best value"; none when there is nothing to compare. */
export function bestValueId(plans: CarpoolPlan[]): number | null {
  if (plans.length < 2) return null;
  const rate = (p: CarpoolPlan) => (p.days_count ? p.amount / p.days_count : Infinity);
  return plans.reduce((best, p) => (rate(p) < rate(best) ? p : best)).id;
}

/**
 * The approved page is shown once, right after approval (Saqib, 2026-11-26);
 * after that the driver goes straight to Home. Remembered per person on this phone.
 */
export class ApprovedSeen {
  private static key(userId: number): string {
    return `dc_cp_approved_seen_${userId}`;
  }

  static get(userId: number | undefined): boolean {
    if (!userId) return false;
    try {
      return localStorage.getItem(ApprovedSeen.key(userId)) === '1';
    } catch {
      return false;
    }
  }

  static set(userId: number | undefined): void {
    if (!userId) return;
    try {
      localStorage.setItem(ApprovedSeen.key(userId), '1');
    } catch {
      /* private mode: the page is simply shown again */
    }
  }
}
