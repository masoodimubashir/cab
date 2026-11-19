import { Component, ElementRef, NgZone, OnDestroy, ViewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { NavController } from '@ionic/angular';
import { PlacesService } from '../../../core/places.service';
import { CarpoolApiService } from '../carpool-api.service';
import { CarpoolRide } from '../carpool.models';
import { LatLng, createMap, drawRide, loadRiderMaps, pickupPin, placeName, snapToPath, toPath } from './rider-map';

/**
 * Request pickup at a place (customer mockup 7, the pin button in chat): drag
 * the pin along the driver's route, then ask. The driver answers with Accept
 * or Decline on the card in the private chat. The pickup must stay before the
 * rider's own drop (the server checks it too).
 */
@Component({
  selector: 'app-carpool-pickup',
  template: `
    <div class="pinview" role="dialog" aria-label="Request a new pickup">
      <div class="map"><div class="gm" #mapEl></div></div>
      <button class="icon-btn float" aria-label="Back" (click)="back()"><ion-icon name="chevron-back-outline"></ion-icon></button>
      <div class="mchip"><ion-icon name="location-outline"></ion-icon>Drag the pin along {{ first }}'s route</div>
      <p class="map-msg" *ngIf="mapFailed">The map couldn't load.</p>
      <div class="bsheet" *ngIf="spot">
        <div class="grab"></div>
        <div class="sheet-in" style="padding-top: 8px">
          <span class="label">New pickup spot</span>
          <h2 style="margin-top: 2px">{{ naming ? 'Finding the place…' : spot.name }}</h2>
          <p class="t13 muted" style="margin-top: 4px">{{ first }} will be asked to accept it. Your current pickup stays until they do.</p>
          <p class="sheet-err" *ngIf="error" role="alert">{{ error }}</p>
          <button class="c-go tall" style="margin-top: 16px" [disabled]="!!error || naming || sending" (click)="send()">{{ sending ? 'Sending…' : 'Ask ' + first }}</button>
        </div>
      </div>
      <div class="center" *ngIf="!spot && !failed"><ion-spinner name="crescent"></ion-spinner></div>
      <p class="sheet-err" style="position: absolute; left: 16px; right: 16px; bottom: 24px; z-index: 6; background: #fff; padding: 12px; border-radius: 12px" *ngIf="failed" role="alert">Couldn't load this carpool. <button class="link" (click)="load()">Try again</button></p>
    </div>
  `,
  styleUrls: ['./carpool-rider.scss'],
  standalone: false,
})
export class CarpoolPickupPage implements OnDestroy {
  @ViewChild('mapEl') mapEl?: ElementRef<HTMLElement>;

  ride: CarpoolRide | null = null;
  spot: { lat: number; lng: number; name: string; address: string | null; along_m: number } | null = null;
  naming = false;
  sending = false;
  failed = false;
  mapFailed = false;
  error: string | null = null;

  private chatId = 0;
  private map: any = null;
  private pin: any = null;

  constructor(
    private route: ActivatedRoute,
    private nav: NavController,
    private carpool: CarpoolApiService,
    private places: PlacesService,
    private zone: NgZone,
  ) {}

  get first(): string {
    return this.ride?.driver.first_name ?? 'the driver';
  }

  ionViewWillEnter(): void {
    this.chatId = Number(this.route.snapshot.paramMap.get('id'));
    this.load();
  }

  ngOnDestroy(): void {
    this.map = null;
    this.pin = null;
  }

  load(): void {
    this.failed = false;
    this.carpool.chat(this.chatId).subscribe({
      next: (t) => {
        this.carpool.ride(t.conversation.listing.id).subscribe({
          next: (ride) => {
            this.ride = ride;
            const m = ride.my_request;
            const at = m ? { lat: m.pickup.lat, lng: m.pickup.lng } : toPath(ride.route_polyline)[0];
            if (at) this.spot = { ...at, name: m?.pickup.name ?? '', address: m?.pickup.address ?? null, along_m: m?.pickup.along_m ?? 0 };
            setTimeout(() => void this.draw());
          },
          error: () => (this.failed = true),
        });
      },
      error: () => (this.failed = true),
    });
  }

  private async draw(): Promise<void> {
    const el = this.mapEl?.nativeElement;
    if (!el || !this.ride || !this.spot) return;
    try {
      await loadRiderMaps(this.places);
    } catch {
      this.mapFailed = true;
      return;
    }
    const path = toPath(this.ride.route_polyline);
    this.map = createMap(el, true);
    drawRide(this.map, path, null, false, false);
    this.pin = pickupPin(this.map, this.spot, (p) => this.zone.run(() => void this.move(p)));
    this.map.addListener('click', (ev: any) => this.zone.run(() => void this.move({ lat: ev.latLng.lat(), lng: ev.latLng.lng() })));
    this.map.setCenter(this.spot);
    this.map.setZoom(15);
  }

  /** Snaps a dragged or tapped spot onto the route and names it. */
  private async move(p: LatLng): Promise<void> {
    if (!this.ride || !this.spot) return;
    const snap = snapToPath(toPath(this.ride.route_polyline), p);
    this.pin.position = { lat: snap.lat, lng: snap.lng };
    const dropAlong = this.ride.my_request?.drop.along_m ?? Infinity;
    this.error = snap.along_m > dropAlong - 300 ? 'Pick a spot before your drop.' : null;
    this.spot = { ...this.spot, lat: snap.lat, lng: snap.lng, along_m: snap.along_m };
    this.naming = true;
    const named = await placeName({ lat: snap.lat, lng: snap.lng }).catch(() => null);
    this.zone.run(() => {
      this.naming = false;
      if (this.spot) this.spot = { ...this.spot, name: named?.name ?? this.spot.name ?? 'Pickup', address: named?.address ?? null };
    });
  }

  send(): void {
    if (!this.spot || this.sending || this.error) return;
    this.sending = true;
    this.carpool.proposePickup(this.chatId, { lat: this.spot.lat, lng: this.spot.lng, name: this.spot.name || 'Pickup', address: this.spot.address }).subscribe({
      next: () => {
        this.sending = false;
        void this.nav.navigateBack(`/carpool/chat/${this.chatId}`);
      },
      error: (e) => {
        this.sending = false;
        this.error = (Object.values(e?.error?.errors ?? {})[0] as string[] | undefined)?.[0] ?? 'Something went wrong. Try again.';
      },
    });
  }

  back(): void {
    void this.nav.navigateBack(`/carpool/chat/${this.chatId}`);
  }
}
