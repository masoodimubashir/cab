import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ActionSheetController, AlertController, ToastController } from '@ionic/angular';
import { ApiService } from '../../core/api.service';
import { AuthService, PaymentMethod } from '../../core/auth.service';
import { PlacesService } from '../../core/places.service';
import {
  RealtimeService,
  TripLocationPayload,
  TripStatusPayload,
} from '../../core/realtime.service';

declare const google: any;

type TripDetail = {
  id: number;
  status: string;
  final_fare: number | null;
  payment_method?: PaymentMethod | null;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  drop_lat?: number | null;
  drop_lng?: number | null;
  pickup_address?: string | null;
  drop_address?: string | null;
  driver?: { id: number; name?: string | null; accepted_payment_methods?: PaymentMethod[] | null };
};

@Component({
  selector: 'app-trip-active',
  templateUrl: './trip-active.page.html',
  styleUrls: ['./trip-active.page.scss'],
  standalone: false,
})
export class TripActivePage implements OnInit, OnDestroy {
  tripId!: number;
  loading = true;
  trip: TripDetail | null = null;
  driverAccepts: PaymentMethod[] = ['cash', 'upi', 'qr'];
  selectedPaymentMethod: PaymentMethod | null = null;
  driverPosition: { lat: number; lng: number } | null = null;
  liveConnected = false;

  private poll: any = null;
  private unsubscribeRealtime: (() => void) | null = null;
  private map: any | null = null;
  private driverMarker: any | null = null;
  private pickupMarker: any | null = null;
  private dropMarker: any | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private api: ApiService,
    private auth: AuthService,
    private alertCtrl: AlertController,
    private actionSheetCtrl: ActionSheetController,
    private toastCtrl: ToastController,
    private places: PlacesService,
    private realtime: RealtimeService
  ) {}

  ngOnInit(): void {
    this.tripId = Number(this.route.snapshot.paramMap.get('tripId'));
    if (!this.tripId) {
      this.router.navigateByUrl('/customer-tabs/book', { replaceUrl: true });
      return;
    }
    this.refresh();
    void this.initMap();
    this.subscribeLive();
    // Slow polling fallback for status, in case Reverb is down.
    this.poll = setInterval(() => this.refresh(), 15000);
  }

  ngOnDestroy(): void {
    if (this.poll) clearInterval(this.poll);
    if (this.unsubscribeRealtime) this.unsubscribeRealtime();
  }

  private subscribeLive(): void {
    this.unsubscribeRealtime = this.realtime.subscribeTracking(
      this.tripId,
      (p) => this.onLocation(p),
      (p) => this.onStatus(p)
    );
    this.liveConnected = !!this.unsubscribeRealtime;
  }

  private async initMap(): Promise<void> {
    try {
      await this.places.ensureLoaded();
      const div = document.getElementById('trip-map');
      if (!div) return;
      this.map = new google.maps.Map(div, {
        center: { lat: 28.6139, lng: 77.209 },
        zoom: 14,
        disableDefaultUI: true,
      });
      this.fitMap();
    } catch {
      /* maps not available — page still works without it */
    }
  }

  private refresh(): void {
    this.api
      .get<{ trip_id: number; trip?: TripDetail; negotiation?: { final_amount: number } }>(
        `/trips/${this.tripId}/negotiation`
      )
      .subscribe({
        next: (res) => {
          this.loading = false;
          if (res?.trip) {
            this.trip = res.trip;
            const driver = res.trip.driver;
            if (driver?.accepted_payment_methods?.length) {
              this.driverAccepts = driver.accepted_payment_methods;
            }
            if (this.selectedPaymentMethod == null && this.trip.payment_method) {
              this.selectedPaymentMethod = this.trip.payment_method;
            }
            this.updateRouteMarkers();
          }
        },
        error: () => {
          this.loading = false;
        },
      });
  }

  private updateRouteMarkers(): void {
    if (!this.map || !this.trip) return;
    const t = this.trip;
    if (t.pickup_lat != null && t.pickup_lng != null) {
      const pos = { lat: Number(t.pickup_lat), lng: Number(t.pickup_lng) };
      if (!this.pickupMarker) {
        this.pickupMarker = new google.maps.Marker({ position: pos, map: this.map, label: 'A' });
      } else {
        this.pickupMarker.setPosition(pos);
      }
    }
    if (t.drop_lat != null && t.drop_lng != null) {
      const pos = { lat: Number(t.drop_lat), lng: Number(t.drop_lng) };
      if (!this.dropMarker) {
        this.dropMarker = new google.maps.Marker({ position: pos, map: this.map, label: 'B' });
      } else {
        this.dropMarker.setPosition(pos);
      }
    }
    this.fitMap();
  }

  private fitMap(): void {
    if (!this.map) return;
    const bounds = new google.maps.LatLngBounds();
    let any = false;
    for (const m of [this.pickupMarker, this.dropMarker, this.driverMarker]) {
      if (m) {
        bounds.extend(m.getPosition());
        any = true;
      }
    }
    if (any) this.map.fitBounds(bounds, 80);
  }

  private onLocation(p: TripLocationPayload): void {
    this.driverPosition = { lat: p.lat, lng: p.lng };
    if (!this.map) return;
    if (!this.driverMarker) {
      this.driverMarker = new google.maps.Marker({
        position: this.driverPosition,
        map: this.map,
        title: 'Driver',
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: '#1f8b4c',
          fillOpacity: 1,
          strokeColor: '#fff',
          strokeWeight: 2,
        },
      });
      this.fitMap();
    } else {
      this.driverMarker.setPosition(this.driverPosition);
    }
  }

  private onStatus(p: TripStatusPayload): void {
    if (!this.trip) return;
    this.trip = { ...this.trip, status: p.status };
  }

  canCancel(): boolean {
    if (!this.trip) return false;
    return ['CONFIRMED', 'ASSIGNED'].includes(this.trip.status);
  }

  isCompleted(): boolean {
    return this.trip?.status === 'COMPLETED';
  }

  async cancel(): Promise<void> {
    const a = await this.alertCtrl.create({
      header: 'Cancel trip?',
      message: 'The driver will be notified.',
      buttons: [
        { text: 'Keep trip', role: 'cancel' },
        {
          text: 'Cancel trip',
          role: 'destructive',
          handler: async () => {
            try {
              await this.api.post(`/trips/${this.tripId}/cancel`, {}).toPromise();
              this.router.navigateByUrl('/customer-tabs/book', { replaceUrl: true });
            } catch (e: any) {
              const t = await this.toastCtrl.create({
                message: e?.error?.message || 'Could not cancel.',
                duration: 2500,
                color: 'danger',
              });
              await t.present();
            }
          },
        },
      ],
    });
    await a.present();
  }

  async pay(): Promise<void> {
    const allowed: PaymentMethod[] = (['cash', 'upi', 'qr'] as PaymentMethod[]).filter((m) =>
      this.driverAccepts.includes(m)
    );
    if (!allowed.length) {
      const t = await this.toastCtrl.create({
        message: 'Driver has no payment methods enabled.',
        duration: 2500,
        color: 'danger',
      });
      await t.present();
      return;
    }

    const sheet = await this.actionSheetCtrl.create({
      header: 'Pay with',
      buttons: [
        ...allowed.map((m) => ({
          text: m.toUpperCase(),
          handler: () => this.doPay(m),
        })),
        { text: 'Cancel', role: 'cancel' },
      ],
    });
    await sheet.present();
  }

  private async doPay(method: PaymentMethod): Promise<void> {
    try {
      await this.api.post(`/trips/${this.tripId}/pay/${method}`, {}).toPromise();
      const t = await this.toastCtrl.create({
        message: 'Payment recorded.',
        duration: 2000,
        color: 'success',
      });
      await t.present();
      this.refresh();
    } catch (e: any) {
      const t = await this.toastCtrl.create({
        message: e?.error?.message || 'Payment failed.',
        duration: 2500,
        color: 'danger',
      });
      await t.present();
    }
  }
}
