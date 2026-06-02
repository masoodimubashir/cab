import { Component, OnInit } from '@angular/core';
import { Location } from '@angular/common';
import { ApiService } from '../../core/api.service';

/** One coupon the customer holds, shaped by GET /me/coupons. */
interface CouponRow {
  id: number;
  title: string;
  subtitle: string | null;
  description: string | null;
  discount_label: string;
  city: string | null;
  status: 'available' | 'used' | 'expired';
  is_available: boolean;
  reason: string | null;
  expires_at: string | null;
  used_at: string | null;
}

/**
 * "My Coupons" — read-only list of the coupons assigned to the customer so
 * they know what they hold and the exact code to type. Redemption still
 * happens on the post-trip payment screen; this page never applies a discount.
 */
@Component({
  selector: 'app-coupons',
  templateUrl: './coupons.page.html',
  styleUrls: ['./coupons.page.scss'],
  standalone: false,
})
export class CouponsPage implements OnInit {
  rows: CouponRow[] = [];
  loading = true;
  error: string | null = null;

  constructor(
    private api: ApiService,
    private location: Location,
  ) {}

  ngOnInit(): void {
    this.load();
  }

  load(event?: any): void {
    this.loading = !event;
    this.error = null;
    this.api.get<{ data: CouponRow[] }>('/me/coupons').subscribe({
      next: (res) => {
        this.rows = res?.data ?? [];
        this.loading = false;
        event?.target?.complete();
      },
      error: () => {
        this.error = 'Could not load your coupons. Pull to retry.';
        this.loading = false;
        event?.target?.complete();
      },
    });
  }

  get hasAvailable(): boolean {
    return this.rows.some((r) => r.is_available);
  }

  back(): void {
    this.location.back();
  }
}
