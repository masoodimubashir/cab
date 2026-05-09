import { Component, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController, ToastController } from '@ionic/angular';
import { Subject, debounceTime, switchMap } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { AuthService, PaymentMethod } from '../../core/auth.service';
import { GeolocationService, LatLng } from '../../core/geolocation.service';
import { PlacesService, PlaceSuggestion } from '../../core/places.service';
import { RealtimeService } from '../../core/realtime.service';
import { environment } from '../../../environments/environment';

declare const google: any;

type RideType = { id: number; name: string; description?: string | null };

type EstimateResponse = {
  currency?: string;
  distance_km?: number;
  time_min?: number;
  estimated_fare?: number;
  commission_percent?: number;
};

type DriverOffer = {
  id?: number;
  from_role: 'customer' | 'driver';
  amount: number;
  status: string;
  from_user_id?: number;
  driver_name?: string;
  created_at?: string;
};

type RideState = 'idle' | 'route' | 'preview' | 'offer' | 'searching' | 'bids';

@Component({
  selector: 'app-customer-book',
  templateUrl: './customer-book.page.html',
  styleUrls: ['./customer-book.page.scss'],
  standalone: false,
})
export class CustomerBookPage implements OnDestroy {
  state: RideState = 'idle';
  loading = false;
  error: string | null = null;

  rideTypes: RideType[] = [];
  selectedRideTypeId: number | null = null;

  pickup: { lat: number; lng: number; address: string } | null = null;
  drop: { lat: number; lng: number; address: string; place_id?: string } | null = null;

  toQuery = '';
  toQuery$ = new Subject<string>();
  suggestions: PlaceSuggestion[] = [];

  estimate: EstimateResponse | null = null;
  fareInput: number | null = null;
  paymentMethod: PaymentMethod = 'cash';
  autoAcceptNearest = false;

  tripId: number | null = null;
  searchSecondsLeft = 60;
  private searchTimer: any = null;

  driverOffers: DriverOffer[] = [];
  private unsubscribeRealtime: (() => void) | null = null;
  private pollHandle: any = null;

  private map: any | null = null;
  private pickupMarker: any | null = null;
  private dropMarker: any | null = null;
  private routeRenderer: any | null = null;
  mapsReady = false;
  mapsError: string | null = null;

  constructor(
    private api: ApiService,
    private auth: AuthService,
    private router: Router,
    private geo: GeolocationService,
    private places: PlacesService,
    private realtime: RealtimeService,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController
  ) {
    this.toQuery$
      .pipe(
        debounceTime(250),
        switchMap((q) => this.places.autocompleteSearch(q, this.pickup ?? undefined))
      )
      .subscribe({
        next: (results) => (this.suggestions = results),
        error: () => (this.suggestions = []),
      });
  }

  ionViewWillEnter(): void {
    this.loadRideTypes();
  }

  ionViewDidEnter(): void {
    void this.initMap();
  }

  ngOnDestroy(): void {
    this.cleanupSearch();
  }

  // ─────────────────────────────────────────────────────────────────
  // Lookups + initial state
  // ─────────────────────────────────────────────────────────────────

  private loadRideTypes(): void {
    this.api.get<{ data: RideType[] }>('/pricing/ride-types').subscribe({
      next: (res) => {
        this.rideTypes = res.data || [];
        if (this.rideTypes.length && this.selectedRideTypeId == null) {
          this.selectedRideTypeId = this.rideTypes[0].id;
        }
      },
      error: () => {
        this.rideTypes = [];
      },
    });
  }

  private async initMap(): Promise<void> {
    try {
      await this.places.ensureLoaded();
      const div = document.getElementById('ride-map');
      if (!div) return;

      const start = (await this.geo.getCurrentPosition()) ?? { lat: 28.6139, lng: 77.209 };
      this.map = new google.maps.Map(div, {
        center: start,
        zoom: 15,
        disableDefaultUI: true,
        clickableIcons: false,
      });

      this.pickupMarker = new google.maps.Marker({
        position: start,
        map: this.map,
        title: 'Pickup',
        draggable: true,
      });

      this.pickupMarker.addListener('dragend', (ev: any) => {
        const lat = ev.latLng.lat();
        const lng = ev.latLng.lng();
        void this.updatePickupTo(lat, lng);
      });

      this.map.addListener('click', (ev: any) => {
        if (this.state !== 'idle') return;
        const lat = ev.latLng.lat();
        const lng = ev.latLng.lng();
        this.pickupMarker.setPosition({ lat, lng });
        void this.updatePickupTo(lat, lng);
      });

      const address = (await this.places.reverseGeocode(start.lat, start.lng)) ?? 'Current location';
      this.pickup = { lat: start.lat, lng: start.lng, address };
      this.mapsReady = true;
    } catch (e) {
      this.mapsError = (e as Error)?.message || 'Could not load map.';
    }
  }

  private async updatePickupTo(lat: number, lng: number): Promise<void> {
    const address = (await this.places.reverseGeocode(lat, lng)) ?? 'Selected location';
    this.pickup = { lat, lng, address };
    if (this.map) this.map.panTo({ lat, lng });
    if (this.drop) {
      await this.showRouteOnMap();
      await this.fetchEstimate();
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // State transitions
  // ─────────────────────────────────────────────────────────────────

  goRoute(): void {
    this.state = 'route';
    this.suggestions = [];
    this.toQuery = '';
  }

  closeSheet(): void {
    if (this.state === 'searching' || this.state === 'bids') return;
    this.state = 'idle';
  }

  onToInput(ev: any): void {
    this.toQuery = ev?.target?.value ?? '';
    this.toQuery$.next(this.toQuery);
  }

  async pickSuggestion(s: PlaceSuggestion): Promise<void> {
    this.loading = true;
    try {
      const detail = await this.places.getPlaceDetail(s.place_id);
      if (!detail) return;
      this.drop = {
        lat: detail.lat,
        lng: detail.lng,
        address: detail.description,
        place_id: detail.place_id,
      };
      this.suggestions = [];
      await this.showRouteOnMap();
      await this.fetchEstimate();
      this.state = 'preview';
    } finally {
      this.loading = false;
    }
  }

  selectRideType(id: number): void {
    this.selectedRideTypeId = id;
    void this.fetchEstimate();
  }

  // ─────────────────────────────────────────────────────────────────
  // Map drawing
  // ─────────────────────────────────────────────────────────────────

  private async showRouteOnMap(): Promise<void> {
    if (!this.map || !this.pickup || !this.drop) return;

    if (this.dropMarker) this.dropMarker.setMap(null);
    this.dropMarker = new google.maps.Marker({
      position: { lat: this.drop.lat, lng: this.drop.lng },
      map: this.map,
      title: 'Drop',
    });

    if (!this.routeRenderer) {
      this.routeRenderer = new google.maps.DirectionsRenderer({
        suppressMarkers: true,
        polylineOptions: { strokeColor: '#000', strokeWeight: 4 },
      });
      this.routeRenderer.setMap(this.map);
    }

    const dirSvc = new google.maps.DirectionsService();
    try {
      const result = await dirSvc.route({
        origin: { lat: this.pickup.lat, lng: this.pickup.lng },
        destination: { lat: this.drop.lat, lng: this.drop.lng },
        travelMode: google.maps.TravelMode.DRIVING,
      });
      this.routeRenderer.setDirections(result);
    } catch {
      const bounds = new google.maps.LatLngBounds();
      bounds.extend({ lat: this.pickup.lat, lng: this.pickup.lng });
      bounds.extend({ lat: this.drop.lat, lng: this.drop.lng });
      this.map.fitBounds(bounds, 80);
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Pricing
  // ─────────────────────────────────────────────────────────────────

  private async fetchEstimate(): Promise<void> {
    if (!this.pickup || !this.drop || this.selectedRideTypeId == null) return;

    try {
      const cities = await this.api.get<{ data: { id: number }[] }>('/pricing/cities').toPromise();
      const cityId = cities?.data?.[0]?.id;
      if (!cityId) return;

      const res = await this.api
        .post<EstimateResponse>('/pricing/estimate', {
          city_id: cityId,
          ride_type_id: this.selectedRideTypeId,
          pickup_lat: this.pickup.lat,
          pickup_lng: this.pickup.lng,
          drop_lat: this.drop.lat,
          drop_lng: this.drop.lng,
        })
        .toPromise();

      this.estimate = res ?? null;
      if (res?.estimated_fare != null) {
        this.fareInput = Math.round(res.estimated_fare / 5) * 5;
      }
    } catch {
      this.estimate = null;
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Offer flow
  // ─────────────────────────────────────────────────────────────────

  goOffer(): void {
    this.state = 'offer';
  }

  async openPaymentSheet(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Payment method',
      inputs: ([
        { type: 'radio', label: 'Cash', value: 'cash', checked: this.paymentMethod === 'cash' },
        { type: 'radio', label: 'UPI', value: 'upi', checked: this.paymentMethod === 'upi' },
        { type: 'radio', label: 'QR code', value: 'qr', checked: this.paymentMethod === 'qr' },
      ] as any[]),
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Select',
          handler: (val: PaymentMethod) => {
            if (val) this.paymentMethod = val;
          },
        },
      ],
    });
    await alert.present();
  }

  async findOffers(): Promise<void> {
    if (!this.pickup || !this.drop || this.selectedRideTypeId == null) return;
    if (this.fareInput == null || this.fareInput <= 0) {
      this.error = 'Please enter your fare offer.';
      return;
    }

    this.loading = true;
    this.error = null;
    try {
      const cities = await this.api.get<{ data: { id: number }[] }>('/pricing/cities').toPromise();
      const cityId = cities?.data?.[0]?.id;
      if (!cityId) throw new Error('No city configured.');

      const tripRes = await this.api
        .post<{ trip: { id: number } }>('/trips', {
          city_id: cityId,
          ride_type_id: this.selectedRideTypeId,
          pickup_address: this.pickup.address,
          pickup_lat: this.pickup.lat,
          pickup_lng: this.pickup.lng,
          drop_address: this.drop.address,
          drop_lat: this.drop.lat,
          drop_lng: this.drop.lng,
          payment_method: this.paymentMethod,
        })
        .toPromise();

      this.tripId = tripRes?.trip?.id ?? null;
      if (!this.tripId) throw new Error('Trip creation failed.');

      await this.sendCustomerOffer(this.fareInput);
      this.startSearching();
    } catch (e: any) {
      this.error = e?.error?.message || e?.message || 'Could not start booking.';
    } finally {
      this.loading = false;
    }
  }

  private async sendCustomerOffer(amount: number): Promise<void> {
    if (!this.tripId) return;
    await this.api
      .post(`/trips/${this.tripId}/negotiation/customer-offer`, { amount })
      .toPromise();
  }

  // ─────────────────────────────────────────────────────────────────
  // Searching + bids
  // ─────────────────────────────────────────────────────────────────

  private startSearching(): void {
    this.state = 'searching';
    this.driverOffers = [];
    this.searchSecondsLeft = 60;
    this.searchTimer = setInterval(() => {
      this.searchSecondsLeft = Math.max(0, this.searchSecondsLeft - 1);
      if (this.searchSecondsLeft <= 0) clearInterval(this.searchTimer);
    }, 1000);

    if (this.tripId) {
      this.unsubscribeRealtime = this.realtime.subscribeNegotiation(
        this.tripId,
        (p) => this.onIncomingOffer(p.offer),
        () => this.onLocked()
      );
    }

    // Polling fallback (every 4s) in case Reverb is not running.
    this.pollHandle = setInterval(() => this.pollNegotiation(), 4000);
  }

  private cleanupSearch(): void {
    if (this.searchTimer) {
      clearInterval(this.searchTimer);
      this.searchTimer = null;
    }
    if (this.pollHandle) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
    if (this.unsubscribeRealtime) {
      this.unsubscribeRealtime();
      this.unsubscribeRealtime = null;
    }
  }

  private pollNegotiation(): void {
    if (!this.tripId) return;
    this.api
      .get<{ trip_id: number; negotiation: { status: string; final_amount: number; offers: DriverOffer[] } }>(
        `/trips/${this.tripId}/negotiation`
      )
      .subscribe({
        next: (res) => {
          const offers = (res?.negotiation?.offers || []).filter(
            (o) => o.from_role === 'driver' && (o.status === 'PENDING' || o.status === 'ACCEPTED')
          );
          for (const o of offers) this.onIncomingOffer(o);
          if (res?.negotiation?.status === 'LOCKED') this.onLocked();
        },
      });
  }

  private onIncomingOffer(offer: DriverOffer): void {
    if (offer.from_role !== 'driver') return;
    const exists = this.driverOffers.some((o) => o.id != null && o.id === offer.id);
    if (exists) return;
    this.driverOffers = [...this.driverOffers, offer];

    if (this.autoAcceptNearest && this.driverOffers.length === 1) {
      void this.confirmOffer(offer);
      return;
    }

    if (this.state === 'searching') this.state = 'bids';
  }

  private onLocked(): void {
    if (!this.tripId) return;
    this.cleanupSearch();
    this.router.navigateByUrl(`/customer-tabs/trip/${this.tripId}`, { replaceUrl: true });
  }

  raiseFare(delta: number): void {
    if (this.fareInput == null) return;
    const next = Math.max(1, this.fareInput + delta);
    this.fareInput = next;
    void this.sendCustomerOffer(next);
  }

  async confirmOffer(offer: DriverOffer): Promise<void> {
    if (!this.tripId) return;

    const ok = await this.alertCtrl.create({
      header: 'Confirm fare',
      message: `Accept ₹${offer.amount} from this driver?`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Confirm',
          role: 'destructive',
          handler: () => this.lockOffer(offer.amount),
        },
      ],
    });
    await ok.present();
  }

  private async lockOffer(amount: number): Promise<void> {
    if (!this.tripId) return;
    try {
      await this.api
        .post(`/trips/${this.tripId}/negotiation/customer-confirm`, { final_fare: amount })
        .toPromise();
      this.onLocked();
    } catch (e: any) {
      const t = await this.toastCtrl.create({
        message: e?.error?.message || 'Could not confirm fare.',
        duration: 2500,
        color: 'danger',
      });
      await t.present();
    }
  }

  async cancelRequest(): Promise<void> {
    if (!this.tripId) {
      this.resetToIdle();
      return;
    }
    const a = await this.alertCtrl.create({
      header: 'Cancel request?',
      message: 'No driver will be assigned. You can request again any time.',
      buttons: [
        { text: 'Keep waiting', role: 'cancel' },
        {
          text: 'Cancel',
          role: 'destructive',
          handler: async () => {
            try {
              await this.api.post(`/trips/${this.tripId}/cancel`, {}).toPromise();
            } catch {
              /* ignore */
            }
            this.resetToIdle();
          },
        },
      ],
    });
    await a.present();
  }

  private resetToIdle(): void {
    this.cleanupSearch();
    this.tripId = null;
    this.driverOffers = [];
    this.state = 'idle';
  }
}
