/**
 * Carpool API types. They follow the backend responses (Carpool.md section 9)
 * and grow milestone by milestone. Keep this file identical in customer-mobile
 * and driver-mobile.
 */

/** GET /api/carpool/config. When `enabled` is false, nothing else is sent. */
export interface CarpoolConfig {
  enabled: boolean;
  search_distance_m?: number;
  publish_horizon_days?: number;
  seats_max?: number;
  message_max_chars?: number;
  timezone?: string;
}

export const CARPOOL_OFF: CarpoolConfig = { enabled: false };
