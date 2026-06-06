import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController, ToastController } from '@ionic/angular';
import { ApiService } from '../../core/api.service';

interface ScheduledRow {
  id: number;
  status: string;
  scheduled_at?: string | null;
  pickup_address?: string | null;
  drop_address?: string | null;
  estimated_fare?: number | null;
  final_fare?: number | null;
  payment_method?: string | null;
  ride_type?: string | null;
  driver?: { id: number; name?: string | null; phone?: string | null } | null;
  created_at?: string | null;
}

type SchedFilter = 'all' | 'awaiting' | 'confirmed';

/**
 * Customer "Scheduled rides" — upcoming pre-booked trips, next pickup first.
 * Mirrors the ride-history visual language (navy hero + white route cards).
 */
@Component({
  selector: 'app-scheduled-rides',
  templateUrl: './scheduled-rides.page.html',
  styleUrls: ['./scheduled-rides.page.scss'],
  standalone: false,
})
export class ScheduledRidesPage {
  loading = false;
  error: string | null = null;
  rides: ScheduledRow[] = [];
  filter: SchedFilter = 'all';

  constructor(
    private api: ApiService,
    private router: Router,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController,
  ) {}

  ionViewWillEnter(): void {
    this.refresh();
  }

  refresh(): void {
    this.loading = true;
    this.error = null;
    this.api.get<{ data: ScheduledRow[] }>('/customer/trips/scheduled').subscribe({
      next: (res) => {
        this.rides = res?.data ?? [];
      },
      error: (err) => {
        this.error = err?.error?.message || 'Could not load scheduled rides';
        this.rides = [];
      },
      complete: () => {
        this.loading = false;
      },
    });
  }

  setFilter(f: SchedFilter): void {
    this.filter = f;
  }

  get visibleRides(): ScheduledRow[] {
    if (this.filter === 'awaiting') {
      return this.rides.filter((r) => ['REQUESTED', 'NEGOTIATION'].includes(r.status));
    }
    if (this.filter === 'confirmed') {
      return this.rides.filter((r) => !['REQUESTED', 'NEGOTIATION'].includes(r.status));
    }
    return this.rides;
  }

  back(): void {
    this.router.navigateByUrl('/customer-tabs/book');
  }

  // ── Display helpers ──────────────────────────────────────────────

  statusLabel(r: ScheduledRow): string {
    switch (r.status) {
      case 'REQUESTED':
      case 'NEGOTIATION':
        return 'Awaiting driver';
      case 'CONFIRMED':
        return 'Confirmed';
      case 'ASSIGNED':
      case 'EN_ROUTE_PICKUP':
      case 'ARRIVED_PICKUP':
        return 'Driver assigned';
      case 'EN_ROUTE_DROP':
      case 'ARRIVED_DROP':
        return 'In progress';
      default:
        return r.status;
    }
  }

  statusColor(r: ScheduledRow): string {
    if (['REQUESTED', 'NEGOTIATION'].includes(r.status)) return 'warning';
    return 'success';
  }

  fareDisplay(r: ScheduledRow): string | null {
    const amount = r.final_fare ?? r.estimated_fare;
    return amount == null ? null : `₹${amount}`;
  }

  /** A scheduled ride can be cancelled while it hasn't started the drive yet. */
  canCancel(r: ScheduledRow): boolean {
    return ['REQUESTED', 'NEGOTIATION', 'CONFIRMED', 'ASSIGNED'].includes(r.status);
  }

  async cancelRide(r: ScheduledRow, event?: Event): Promise<void> {
    event?.stopPropagation();
    const alert = await this.alertCtrl.create({
      header: 'Cancel scheduled ride?',
      message: 'This will cancel your pre-booked ride. A fee may apply if it is close to pickup time.',
      buttons: [
        { text: 'Keep it', role: 'cancel' },
        {
          text: 'Cancel ride',
          role: 'destructive',
          handler: () => {
            this.api.post(`/trips/${r.id}/cancel`, { reason: 'Customer cancelled scheduled ride' }).subscribe({
              next: async () => {
                this.rides = this.rides.filter((x) => x.id !== r.id);
                const t = await this.toastCtrl.create({ message: 'Scheduled ride cancelled.', duration: 2000, color: 'medium' });
                await t.present();
              },
              error: async (err) => {
                const t = await this.toastCtrl.create({
                  message: err?.error?.message || 'Could not cancel the ride.',
                  duration: 2500,
                  color: 'danger',
                });
                await t.present();
              },
            });
          },
        },
      ],
    });
    await alert.present();
  }

  /** Open the live trip screen (negotiation / tracking) for a ride. */
  openRide(r: ScheduledRow): void {
    if (!Number.isFinite(r.id)) return;
    this.router.navigateByUrl(`/customer-tabs/trip/${r.id}`);
  }
}
