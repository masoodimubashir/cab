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
  etaMinutes: number | null = null;
  etaUpdatedAt: number | null = null;

  // Rating state
  ratingScore = 0;
  ratingComment = '';
  ratingBusy = false;
  ratingSubmitted = false;

  // SOS / share-link state
  sosBusy = false;
  shareBusy = false;

  private poll: any = null;
  private unsubscribeRealtime: (() => void) | null = null;
  private map: any | null = null;
  private driverMarker: any | null = null;
  private pickupMarker: any | null = null;
  private dropMarker: any | null = null;
  private etaDebounceHandle: any = null;
  private etaInflight = false;
  private readonly etaDebounceMs = 10_000;
  private distanceMatrix: any | null = null;

  // Customer's own location stream (so the driver app can render us moving).
  private geoWatchId: number | null = null;
  private lastCustomerPostAt = 0;
  private readonly customerPostMinIntervalMs = 5_000;
  private selfMarker: any | null = null;
  selfPosition: { lat: number; lng: number } | null = null;

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
    if (this.etaDebounceHandle) clearTimeout(this.etaDebounceHandle);
    this.stopCustomerLocationStream();
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
            this.syncCustomerLocationStream();
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
    for (const m of [this.pickupMarker, this.dropMarker, this.driverMarker, this.selfMarker]) {
      if (m) {
        bounds.extend(m.getPosition());
        any = true;
      }
    }
    if (any) this.map.fitBounds(bounds, 80);
  }

  private onLocation(p: TripLocationPayload): void {
    this.driverPosition = { lat: p.lat, lng: p.lng };
    this.scheduleEtaUpdate();
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

  /**
   * Debounced ETA refresh. Only runs while the driver is en-route to pickup
   * (ASSIGNED / EN_ROUTE_PICKUP). After ARRIVED_PICKUP we stop estimating.
   */
  private scheduleEtaUpdate(): void {
    if (!this.shouldComputeEta()) return;
    if (this.etaDebounceHandle) clearTimeout(this.etaDebounceHandle);
    this.etaDebounceHandle = setTimeout(() => {
      this.etaDebounceHandle = null;
      void this.refreshEta();
    }, this.etaDebounceMs);
  }

  private shouldComputeEta(): boolean {
    const s = this.trip?.status;
    return s === 'ASSIGNED' || s === 'EN_ROUTE_PICKUP';
  }

  private async refreshEta(): Promise<void> {
    if (this.etaInflight) return;
    if (!this.shouldComputeEta()) return;
    if (!this.driverPosition) return;
    const t = this.trip;
    if (!t || t.pickup_lat == null || t.pickup_lng == null) return;

    try {
      await this.places.ensureLoaded();
      if (!this.distanceMatrix && typeof google !== 'undefined') {
        this.distanceMatrix = new google.maps.DistanceMatrixService();
      }
      if (!this.distanceMatrix) return;

      this.etaInflight = true;
      const origin = { lat: this.driverPosition.lat, lng: this.driverPosition.lng };
      const destination = { lat: Number(t.pickup_lat), lng: Number(t.pickup_lng) };

      this.distanceMatrix.getDistanceMatrix(
        {
          origins: [origin],
          destinations: [destination],
          travelMode: 'DRIVING',
        },
        (response: any, status: string) => {
          this.etaInflight = false;
          if (status !== 'OK' || !response?.rows?.[0]?.elements?.[0]) return;
          const el = response.rows[0].elements[0];
          if (el.status !== 'OK' || !el.duration?.value) return;
          this.etaMinutes = Math.max(1, Math.round(el.duration.value / 60));
          this.etaUpdatedAt = Date.now();
        }
      );
    } catch {
      this.etaInflight = false;
    }
  }

  private onStatus(p: TripStatusPayload): void {
    if (!this.trip) return;
    this.trip = { ...this.trip, status: p.status };
    if (!this.shouldComputeEta()) {
      this.etaMinutes = null;
      if (this.etaDebounceHandle) {
        clearTimeout(this.etaDebounceHandle);
        this.etaDebounceHandle = null;
      }
    }
    this.syncCustomerLocationStream();
  }

  // ─────────────────────────────────────────────────────────────────
  // Customer-side location stream (drives the driver app's customer marker)
  // ─────────────────────────────────────────────────────────────────

  /**
   * Start streaming our GPS while the trip is in any state where the driver
   * needs to see us; stop afterwards. Idempotent — safe to call repeatedly.
   */
  private syncCustomerLocationStream(): void {
    const s = this.trip?.status;
    const shouldStream =
      s === 'CONFIRMED' ||
      s === 'ASSIGNED' ||
      s === 'EN_ROUTE_PICKUP' ||
      s === 'ARRIVED_PICKUP' ||
      s === 'EN_ROUTE_DROP' ||
      s === 'ARRIVED_DROP';
    if (shouldStream) this.startCustomerLocationStream();
    else this.stopCustomerLocationStream();
  }

  private startCustomerLocationStream(): void {
    if (this.geoWatchId !== null) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;

    this.geoWatchId = navigator.geolocation.watchPosition(
      (pos) => this.onOwnPosition(pos),
      () => {
        // permission denied or other error — quietly stop trying
        this.stopCustomerLocationStream();
      },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 10_000 }
    );
  }

  private stopCustomerLocationStream(): void {
    if (this.geoWatchId !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(this.geoWatchId);
    }
    this.geoWatchId = null;
  }

  private onOwnPosition(pos: GeolocationPosition): void {
    const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    this.selfPosition = p;

    // Render/move our own marker every tick so the customer can visually
    // confirm where they are relative to the driver.
    if (this.map) {
      if (!this.selfMarker) {
        this.selfMarker = new google.maps.Marker({
          position: p,
          map: this.map,
          title: 'You',
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 7,
            fillColor: '#1e6cf0',
            fillOpacity: 1,
            strokeColor: '#fff',
            strokeWeight: 2,
          },
          zIndex: 4,
        });
        this.fitMap();
      } else {
        this.selfMarker.setPosition(p);
      }
    }

    // Throttle the network POST to one per 5s, independent of the marker render.
    const now = Date.now();
    if (now - this.lastCustomerPostAt < this.customerPostMinIntervalMs) return;
    this.lastCustomerPostAt = now;

    const body = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy_m: pos.coords.accuracy ?? null,
    };

    this.api.post(`/trips/${this.tripId}/customer-location`, body).subscribe({
      next: () => {},
      error: (err: any) => {
        // 409 = trip is no longer in an active state — stop streaming.
        if (err?.status === 409) this.stopCustomerLocationStream();
        // 429 = throttled; backoff bumps the next-allowed timestamp.
        if (err?.status === 429) this.lastCustomerPostAt = now + 2_000;
      },
    });
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

  // ─────────────────────────────────────────────────────────────────
  // Rating (post-trip)
  // ─────────────────────────────────────────────────────────────────

  setRating(score: number): void {
    if (this.ratingSubmitted || this.ratingBusy) return;
    this.ratingScore = score;
  }

  async submitRating(): Promise<void> {
    if (this.ratingScore < 1 || this.ratingScore > 5) {
      const t = await this.toastCtrl.create({
        message: 'Pick a star rating first.',
        duration: 2000,
        color: 'warning',
      });
      await t.present();
      return;
    }
    this.ratingBusy = true;
    try {
      await this.api
        .post(`/trips/${this.tripId}/rating`, {
          score: this.ratingScore,
          comment: this.ratingComment.trim() || null,
        })
        .toPromise();
      this.ratingSubmitted = true;
      const t = await this.toastCtrl.create({
        message: 'Thanks for the rating!',
        duration: 2000,
        color: 'success',
      });
      await t.present();
    } catch (e: any) {
      const msg = e?.error?.message || 'Could not submit rating.';
      // 409 already-rated should still feel like success on the next render.
      if (e?.status === 409) {
        this.ratingSubmitted = true;
      }
      const t = await this.toastCtrl.create({ message: msg, duration: 2500, color: 'danger' });
      await t.present();
    } finally {
      this.ratingBusy = false;
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // SOS
  // ─────────────────────────────────────────────────────────────────

  canSOS(): boolean {
    const s = this.trip?.status;
    if (!s) return false;
    return s !== 'COMPLETED' && s !== 'CANCELLED';
  }

  async triggerSOS(): Promise<void> {
    if (this.sosBusy) return;
    const a = await this.alertCtrl.create({
      header: 'Send SOS?',
      message: 'Admins will be alerted with your trip and current location.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Send SOS',
          role: 'destructive',
          handler: () => {
            void this.doTriggerSOS();
          },
        },
      ],
    });
    await a.present();
  }

  private async doTriggerSOS(): Promise<void> {
    this.sosBusy = true;
    const payload: { lat?: number; lng?: number } = {};
    try {
      const pos = await this.getCurrentPosition();
      if (pos) {
        payload.lat = pos.lat;
        payload.lng = pos.lng;
      }
    } catch {
      // best-effort; backend accepts no coords
    }
    try {
      await this.api.post(`/trips/${this.tripId}/sos`, payload).toPromise();
      const t = await this.toastCtrl.create({
        message: 'SOS sent. Help is on the way.',
        duration: 3000,
        color: 'success',
      });
      await t.present();
    } catch (e: any) {
      const t = await this.toastCtrl.create({
        message: e?.error?.message || 'Could not send SOS.',
        duration: 3000,
        color: 'danger',
      });
      await t.present();
    } finally {
      this.sosBusy = false;
    }
  }

  private getCurrentPosition(): Promise<{ lat: number; lng: number } | null> {
    return new Promise((resolve) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        resolve(null);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 10_000 }
      );
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // Share trip link
  // ─────────────────────────────────────────────────────────────────

  canShare(): boolean {
    return this.canSOS();
  }

  async shareTrip(): Promise<void> {
    if (this.shareBusy) return;
    this.shareBusy = true;
    try {
      const res: any = await this.api
        .post(`/trips/${this.tripId}/share-link`, {})
        .toPromise();
      const token = res?.token;
      if (!token) throw new Error('No token returned');

      const shareUrl = this.buildShareUrl(token);
      const text = `Track my trip: ${shareUrl}`;

      const nav = (typeof navigator !== 'undefined' ? (navigator as any) : null);
      if (nav?.share) {
        try {
          await nav.share({ title: 'My DreamCabs trip', text, url: shareUrl });
          return;
        } catch {
          // user cancelled or share failed — fall through to clipboard
        }
      }

      if (nav?.clipboard?.writeText) {
        await nav.clipboard.writeText(shareUrl);
        const t = await this.toastCtrl.create({
          message: 'Link copied to clipboard.',
          duration: 2500,
          color: 'success',
        });
        await t.present();
      } else {
        const a = await this.alertCtrl.create({
          header: 'Share this link',
          message: shareUrl,
          buttons: ['OK'],
        });
        await a.present();
      }
    } catch (e: any) {
      const t = await this.toastCtrl.create({
        message: e?.error?.message || 'Could not generate share link.',
        duration: 2500,
        color: 'danger',
      });
      await t.present();
    } finally {
      this.shareBusy = false;
    }
  }

  private buildShareUrl(token: string): string {
    // The backend exposes `GET /trips/share/{token}` returning JSON. Until a
    // dedicated public web view exists, point to the API endpoint.
    return `${this.api.baseUrl()}/trips/share/${token}`;
  }
}
