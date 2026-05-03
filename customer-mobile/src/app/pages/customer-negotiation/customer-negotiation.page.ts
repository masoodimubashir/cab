import { Component } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../core/api.service';

type NegotiationOffer = {
  id?: number;
  from_role: string;
  amount: number;
  status: string;
  created_at?: string;
  accepted_by_user_id?: number | null;
};

type Negotiation = {
  status?: string;
  final_amount?: number | null;
  offers?: NegotiationOffer[];
};

@Component({
  selector: 'app-customer-negotiation',
  templateUrl: './customer-negotiation.page.html',
  styleUrls: ['./customer-negotiation.page.scss'],
  standalone: false,
})
export class CustomerNegotiationPage {
  tripId = 0;
  loading = false;
  error: string | null = null;

  negotiation: Negotiation | null = null;
  offerAmount: number | null = null;
  sendingOffer = false;
  confirming = false;

  constructor(
    private route: ActivatedRoute,
    private api: ApiService,
    private router: Router
  ) {}

  ionViewWillEnter(): void {
    const rawId = this.route.snapshot.paramMap.get('tripId');
    this.tripId = rawId ? Number(rawId) : 0;
    this.loadNegotiation();
  }

  private loadNegotiation(): void {
    if (!Number.isFinite(this.tripId) || this.tripId < 1) {
      this.error = 'Invalid trip id.';
      this.negotiation = null;
      return;
    }

    this.loading = true;
    this.error = null;

    this.api.get<{ trip_id: number; negotiation: Negotiation | null }>(`/trips/${this.tripId}/negotiation`).subscribe({
      next: (res) => {
        this.negotiation = res.negotiation;
        this.offerAmount = null;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Could not load negotiation.';
        this.negotiation = null;
      },
      complete: () => {
        this.loading = false;
      },
    });
  }

  refresh(): void {
    this.loadNegotiation();
  }

  get offers(): NegotiationOffer[] {
    return this.negotiation?.offers || [];
  }

  get canSendOffer(): boolean {
    return this.offerAmount != null && Number.isFinite(this.offerAmount) && this.offerAmount >= 0 && !this.loading && !this.sendingOffer;
  }

  get canConfirm(): boolean {
    return (
      this.negotiation?.final_amount != null &&
      Number.isFinite(this.negotiation.final_amount) &&
      !this.loading &&
      !this.confirming
    );
  }

  sendOffer(): void {
    if (!this.canSendOffer) return;
    if (!Number.isFinite(this.tripId) || this.tripId < 1) return;

    this.error = null;
    this.sendingOffer = true;

    this.api
      .post<{ negotiation: Negotiation; offer: NegotiationOffer }>(
        `/trips/${this.tripId}/negotiation/customer-offer`,
        { amount: this.offerAmount }
      )
      .subscribe({
        next: (res: { negotiation: Negotiation; offer: NegotiationOffer }) => {
          this.negotiation = res.negotiation;
        },
        error: (err) => {
          this.error = err?.error?.message || 'Offer failed.';
        },
        complete: () => {
          this.sendingOffer = false;
        },
      });
  }

  confirmFinalFare(): void {
    if (!this.canConfirm) return;
    if (!Number.isFinite(this.tripId) || this.tripId < 1) return;

    const finalFare = this.negotiation?.final_amount;
    if (finalFare == null) return;

    this.error = null;
    this.confirming = true;

    this.api
      .post(`/trips/${this.tripId}/negotiation/customer-confirm`, { final_fare: finalFare })
      .subscribe({
        next: () => {
          this.router.navigateByUrl('/customer-tabs/my-trips', { replaceUrl: true });
        },
        error: (err) => {
          this.error = err?.error?.message || 'Confirm failed.';
        },
        complete: () => {
          this.confirming = false;
        },
      });
  }

  goBack(): void {
    this.router.navigateByUrl('/customer-tabs/my-trips', { replaceUrl: true });
  }
}

