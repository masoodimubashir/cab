import { Component, ElementRef, NgZone, OnDestroy, ViewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { NavController } from '@ionic/angular';
import { PlacesService } from '../../../core/places.service';
import { CarpoolApiService } from '../carpool-api.service';
import { CarpoolListing } from '../carpool.models';
import { askedMarker, createMap, drawRoutes, flatMetres, focusMap, loadCarpoolMaps, pickupPin, placeName, snapToPath, toPath } from './carpool-map';

/**
 * Suggest another spot (driver mockup 14b), opened from "Another spot" on a
 * rider's pickup card in chat. The pin moves only along the driver's route;
 * a grey marker shows where the rider asked. Sending puts a new pickup card in
 * the chat, and the rider accepts it or asks again.
 */
@Component({
  selector: 'app-carpool-pickup',
  template: `
    <div class="pinview" role="dialog" aria-label="Suggest another pickup spot">
      <div class="map" style="position: absolute; inset: 0"><div class="gm" #mapEl></div></div>
      <button class="icon-btn float" aria-label="Back" (click)="back()"><ion-icon name="chevron-back-outline"></ion-icon></button>
      <div class="mchip"><ion-icon name="location-outline"></ion-icon>Drag the pin along your route</div>
      <p class="map-msg" *ngIf="mapFailed">The map couldn't load.</p>
      <div class="center" *ngIf="!spot && !failed"><ion-spinner name="crescent"></ion-spinner></div>
      <div class="bsheet" *ngIf="spot">
        <div class="grab"></div>
        <div style="padding: 8px 20px 18px">
          <span class="label">New pickup for {{ first }}</span>
          <h2 style="margin: 2px 0 0; font-size: 19px; font-weight: 800">{{ naming ? 'Finding the place…' : spot.name }}</h2>
          <p class="st ok" style="margin-top: 4px" *ngIf="!error"><ion-icon name="checkmark-circle"></ion-icon>On your route{{ fromAsked ? ' · ' + fromAsked : '' }}</p>
          <p class="req-err" *ngIf="error" role="alert">{{ error }}</p>
          <div style="margin-top: 16px" *ngIf="!sent"><button class="d-go" [disabled]="!!error || naming || sending" (click)="send()">{{ sending ? 'Sending…' : 'Send to ' + first }}</button></div>
          <p class="done" *ngIf="sent" role="status"><ion-icon name="checkmark-circle"></ion-icon><span>Sent. {{ first }} can accept it in the chat.</span></p>
        </div>
      </div>
      <p class="req-err" style="position: absolute; left: 16px; right: 16px; bottom: 24px; z-index: 6; background: #fff; padding: 12px; border-radius: 12px" *ngIf="failed" role="alert">Couldn't load this chat. <button class="link" (click)="load()">Try again</button></p>
    </div>
  `,
  styleUrls: ['./carpool-driver.scss'],
  styles: [`
    .pinview { position: fixed; inset: 0; z-index: 30; background: #eef1f4; font-family: Roboto, "Segoe UI", system-ui, sans-serif; color: #0d1b2a; }
    .pinview .bsheet { position: absolute; z-index: 31; }
    .mchip { position: absolute; top: calc(12px + env(safe-area-inset-top)); left: 72px; right: 16px; z-index: 5; display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 14px; border-radius: 22px; background: #fff; box-shadow: 0 3px 12px #192d3e18; font-size: 13px; font-weight: 700; }
    .mchip ion-icon { flex: none; font-size: 17px; color: #087f50; }
    .label { font-size: 12px; font-weight: 700; color: #5a6a80; }
    .st.ok { color: #087f50; }
    .done { display: flex; align-items: center; justify-content: center; gap: 6px; min-height: 56px; margin: 16px 0 0; color: #087f50; font-weight: 700; }
    .done ion-icon { font-size: 20px; }
    .center { position: absolute; inset: 0; display: grid; place-items: center; }
  `],
  standalone: false,
})
export class CarpoolPickupPage implements OnDestroy {
  @ViewChild('mapEl') mapEl?: ElementRef<HTMLElement>;

  listing: CarpoolListing | null = null;
  first = 'the rider';
  spot: { lat: number; lng: number; name: string; address: string | null } | null = null;
  fromAsked = '';
  naming = false;
  sending = false;
  sent = false;
  failed = false;
  mapFailed = false;
  error: string | null = null;

  private chatId = 0;
  /** The card being answered (from "Another spot"), and so whose pickup it is. */
  private proposalId = 0;
  private requestId: number | null = null;
  private asked: { lat: number; lng: number } | null = null;
  private askedName = '';
  private map: any = null;
  private pin: any = null;

  constructor(
    private route: ActivatedRoute,
    private nav: NavController,
    private carpool: CarpoolApiService,
    private places: PlacesService,
    private zone: NgZone,
  ) {}

  ionViewWillEnter(): void {
    this.chatId = Number(this.route.snapshot.paramMap.get('id'));
    this.proposalId = Number(this.route.snapshot.queryParamMap.get('proposal') ?? 0);
    this.sent = false;
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
        // Where the rider asked: the card we came from, else the latest waiting rider request, else their current pickup.
        const waiting = (m: { proposal: { status: string; proposed_by: string } | null }) => m.proposal?.status === 'pending' && m.proposal.proposed_by === 'rider';
        const asked = (this.proposalId
          ? t.messages.find((m) => m.proposal?.id === this.proposalId)
          : [...t.messages].reverse().find(waiting))?.proposal;
        this.requestId = asked?.request_id ?? t.conversation.request_id;
        this.first = asked?.rider_first_name ?? t.conversation.other_first_name ?? 'the rider';
        const finish = (at: { lat: number; lng: number }, name: string) => {
          this.asked = at;
          this.askedName = name;
          this.carpool.listing(t.conversation.listing.id).subscribe({
            next: (l) => {
              this.listing = l;
              this.spot = { lat: at.lat, lng: at.lng, name, address: null };
              setTimeout(() => void this.draw());
            },
            error: () => (this.failed = true),
          });
        };
        if (asked) finish({ lat: asked.lat, lng: asked.lng }, asked.name);
        else if (this.requestId) {
          this.carpool.joinRequest(this.requestId).subscribe({
            next: (r) => finish({ lat: r.pickup.lat, lng: r.pickup.lng }, r.pickup.name),
            error: () => (this.failed = true),
          });
        } else this.failed = true;
      },
      error: () => (this.failed = true),
    });
  }

  private async draw(): Promise<void> {
    const el = this.mapEl?.nativeElement;
    if (!el || !this.listing || !this.spot || !this.asked) return;
    try {
      await loadCarpoolMaps(this.places);
    } catch {
      this.mapFailed = true;
      return;
    }
    const path = toPath(this.listing.route_polyline);
    this.map = createMap(el);
    drawRoutes(this.map, [path], 0);
    askedMarker(this.map, this.asked, `${this.first} asked here`);
    this.pin = pickupPin(this.map, this.spot, (p) => this.zone.run(() => void this.move(p)));
    this.map.addListener('click', (ev: any) => this.zone.run(() => void this.move({ lat: ev.latLng.lat(), lng: ev.latLng.lng() })));
    focusMap(this.map, this.spot, 16);
  }

  /** Snaps a dragged or tapped spot onto the route and names it. */
  private async move(p: { lat: number; lng: number }): Promise<void> {
    if (!this.listing || !this.spot || !this.asked) return;
    const snap = snapToPath(toPath(this.listing.route_polyline), p);
    this.pin.position = { lat: snap.lat, lng: snap.lng };
    this.error = null;
    this.spot = { ...this.spot, lat: snap.lat, lng: snap.lng };
    const away = Math.round(flatMetres(this.asked, snap));
    this.fromAsked = away < 30 ? `at the same spot` : `${away} m from ${this.askedName}`;
    this.naming = true;
    const named = await placeName(snap).catch(() => null);
    this.zone.run(() => {
      this.naming = false;
      if (this.spot) this.spot = { ...this.spot, name: named?.name ?? this.spot.name, address: named?.address ?? null };
    });
  }

  send(): void {
    if (!this.spot || this.sending || this.error) return;
    this.sending = true;
    this.carpool.proposePickup(this.chatId, { lat: this.spot.lat, lng: this.spot.lng, name: this.spot.name || 'Pickup', address: this.spot.address, request_id: this.requestId ?? undefined }).subscribe({
      next: () => {
        this.sending = false;
        this.sent = true;
        setTimeout(() => this.back(), 1400);
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
