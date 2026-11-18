/**
 * Carpool API types. They follow the backend responses (Carpool.md section 9)
 * and grow milestone by milestone. Keep this file identical in customer-mobile
 * and driver-mobile.
 */

/**
 * GET /api/carpool/config. When `enabled` is false only `driver_signup` is sent:
 * private car owners can sign up before carpool opens to riders (A38).
 */
export interface CarpoolConfig {
  enabled: boolean;
  driver_signup?: boolean;
  search_distance_m?: number;
  publish_horizon_days?: number;
  seats_max?: number;
  message_max_chars?: number;
  timezone?: string;
}

export const CARPOOL_OFF: CarpoolConfig = { enabled: false };

/** GET /api/carpool/plans: a plan the driver can buy (day-based, no commission). */
export interface CarpoolPlan {
  id: number;
  title: string;
  subtitle: string | null;
  amount: number;
  days_count: number;
  terms: string | null;
}

/** A bought plan, running or waiting to start. */
export interface CarpoolPlanPurchase {
  id: number;
  title: string;
  amount_paid: number;
  days_count: number;
  starts_at: string | null;
  expires_at: string | null;
  is_queued: boolean;
}

/** GET /api/carpool/plan. `can_publish` is the publish gate; `ending_soon` drives the Home warning. */
export interface CarpoolPlanState {
  plan: CarpoolPlanPurchase | null;
  next_plan: CarpoolPlanPurchase | null;
  can_publish: boolean;
  ending_soon: boolean;
}

/** POST /api/carpool/plan/upi/order: what Razorpay Checkout needs. */
export interface CarpoolUpiOrder {
  order_id: string;
  amount_paise: number;
  amount: number;
  currency: string;
  key_id: string;
  plan_id: number;
  plan_title: string;
}

export interface CarpoolPaymentResult {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}
