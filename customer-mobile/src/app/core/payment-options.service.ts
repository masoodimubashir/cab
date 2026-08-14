import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';

/** Which payment methods the operator has switched on (Operator Settings →
 *  Payments). The shared payment modal renders only the enabled ones. */
export interface OperatorPaymentMethods {
  online: boolean;
  gpay: boolean;
  cash: boolean;
  /** Upfront share paid online when Cash is chosen; the rest is cash to the driver. */
  cash_deposit_percent: number;
}

const FALLBACK: OperatorPaymentMethods = {
  online: true,
  gpay: false,
  cash: false,
  cash_deposit_percent: 0,
};

/**
 * Fetches the operator's enabled payment methods for the customer app. Cached
 * for the session; call `load(true)` to refresh, `clear()` on logout.
 */
@Injectable({ providedIn: 'root' })
export class PaymentOptionsService {
  private cache: OperatorPaymentMethods | null = null;

  constructor(private api: ApiService) {}

  async load(force = false): Promise<OperatorPaymentMethods> {
    if (this.cache && !force) return this.cache;
    try {
      const res = await firstValueFrom(this.api.get<OperatorPaymentMethods>('/operator/payment-methods'));
      this.cache = {
        online: !!res?.online,
        gpay: !!res?.gpay,
        cash: !!res?.cash,
        cash_deposit_percent: Number(res?.cash_deposit_percent ?? 0),
      };
    } catch {
      // Fail safe to online-only so the customer can always pay.
      this.cache = { ...FALLBACK };
    }
    return this.cache;
  }

  clear(): void {
    this.cache = null;
  }
}
