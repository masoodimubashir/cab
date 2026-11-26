import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, NgZone, OnDestroy, Optional, Output, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';

declare const google: any;

export interface MapPoint { lat: number; lng: number; }
export interface MapPicked extends MapPoint { name: string; address: string; }

export const SRINAGAR: MapPoint = { lat: 34.0837, lng: 74.7973 };

/**
 * Choose on map (mockup 3b, 2c): a full-screen map with a pin fixed in the middle.
 * The map moves under the pin; when it stops, the card names the spot. "Use this
 * spot" hands the point back like picking a search suggestion.
 * Shared by the driver app and the customer app: keep both copies identical.
 * The opening screen supplies how to load Maps, name a point and find the phone.
 */
@Component({
  selector: 'cp-map-pick',
  standalone: true,
  imports: [CommonModule, IonicModule],
  template: `
    <div class="mp" role="dialog" [attr.aria-label]="'Choose ' + label + ' on map'">
      <div class="mp-map" #mapEl></div>
      <svg class="mp-pin" viewBox="0 0 38 48" aria-hidden="true"><path d="M19 46C14 36 2 27 2 17a17 17 0 0 1 34 0c0 10-12 19-17 29z" fill="#087f50" stroke="#fff" stroke-width="3"/><circle cx="19" cy="17" r="6.5" fill="#fff"/></svg>
      <button type="button" class="mp-btn mp-back" aria-label="Back" (click)="closed.emit()"><ion-icon name="chevron-back-outline"></ion-icon></button>
      <div class="mp-hint"><ion-icon name="location-outline" aria-hidden="true"></ion-icon>Move the map to put the pin on the spot</div>
      <button type="button" class="mp-btn mp-me" aria-label="Go to my location" [disabled]="!map" (click)="goToMe()"><ion-icon name="navigate-outline"></ion-icon></button>
      <div class="mp-card">
        <span class="mp-label">{{ label }}</span>
        <ng-container [ngSwitch]="state">
          <p class="mp-msg" *ngSwitchCase="'error'" role="alert">We couldn't load the map. Check your connection and try again.</p>
          <ng-container *ngSwitchCase="'ready'">
            <h2 class="mp-name">{{ place?.name }}</h2>
            <p class="mp-sub">{{ place?.address }}</p>
          </ng-container>
          <p class="mp-msg" *ngSwitchDefault aria-live="polite">Finding the place…</p>
        </ng-container>
        <button type="button" class="mp-go" [disabled]="!canUse" (click)="use()">Use this spot</button>
      </div>
    </div>
  `,
  styles: [`
    :host { position: fixed; inset: 0; z-index: 30000; display: block; font-family: Roboto, "Segoe UI", system-ui, sans-serif; color: #0d1b2a; }
    .mp { position: absolute; inset: 0; background: #e9efeb; }
    .mp-map { position: absolute; inset: 0 0 calc(150px + env(safe-area-inset-bottom)); }
    .mp-pin { position: absolute; left: 50%; top: calc((100% - 150px - env(safe-area-inset-bottom)) / 2); width: 38px; height: 48px; margin: -48px 0 0 -19px; pointer-events: none; }
    .mp-btn { position: absolute; display: grid; place-items: center; width: 44px; height: 44px; padding: 0; border: 1px solid #e2e8f0; border-radius: 50%; background: #fff; color: #0d1b2a; font-size: 21px; }
    .mp-btn:disabled { opacity: .5; }
    .mp-back { top: calc(12px + env(safe-area-inset-top)); left: 16px; }
    .mp-hint { position: absolute; top: calc(12px + env(safe-area-inset-top)); left: 72px; right: 16px; display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 14px; border: 1px solid #e2e8f0; border-radius: 22px; background: #fff; font-size: 13px; font-weight: 700; }
    .mp-hint ion-icon { flex: none; font-size: 17px; color: #087f50; }
    .mp-me { right: 16px; bottom: calc(200px + env(safe-area-inset-bottom)); }
    .mp-card { position: absolute; left: 0; right: 0; bottom: 0; padding: 18px 20px calc(18px + env(safe-area-inset-bottom)); border-top: 1px solid #e2e8f0; border-radius: 26px 26px 0 0; background: #fff; }
    .mp-label { display: block; font-size: 12px; font-weight: 700; color: #5a6a80; }
    .mp-name { margin: 2px 0 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 19px; font-weight: 800; }
    .mp-sub, .mp-msg { margin: 4px 0 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 13px; color: #5a6a80; }
    .mp-msg { min-height: 47px; padding-top: 6px; }
    .mp-go { display: flex; align-items: center; justify-content: center; width: 100%; min-height: 52px; margin-top: 16px; border: 0; border-radius: 14px; background: #087f50; color: #fff; font: 700 15px Roboto, "Segoe UI", system-ui, sans-serif; }
    .mp-go:disabled { opacity: .45; }
    button:focus-visible { outline: 2px solid #087f50; outline-offset: 2px; }
  `],
})
export class CarpoolMapPickComponent implements AfterViewInit, OnDestroy {
  @ViewChild('mapEl') mapEl?: ElementRef<HTMLDivElement>;
  /** The field being filled: "From", "To", "Pickup" or "Drop". */
  @Input() label = 'Spot';
  /** The place already in the field, if any. */
  @Input() start: MapPoint | null = null;
  @Input() load: () => Promise<void> = async () => undefined;
  @Input() name: (at: MapPoint) => Promise<{ name: string; address: string } | null> = async () => null;
  @Input() locate: () => Promise<MapPoint | null> = async () => null;
  @Output() picked = new EventEmitter<MapPicked>();
  @Output() closed = new EventEmitter<void>();

  state: 'finding' | 'ready' | 'error' = 'finding';
  place: { name: string; address: string } | null = null;
  map: any = null;
  private at: MapPoint | null = null;
  private seq = 0;
  private listeners: any[] = [];

  constructor(@Optional() private zone?: NgZone, @Optional() private cdr?: ChangeDetectorRef) {}

  static firstCentre(start: MapPoint | null, mine: MapPoint | null): MapPoint {
    return start ?? mine ?? SRINAGAR;
  }

  get canUse(): boolean {
    return this.state === 'ready' && !!this.at && !!this.place;
  }

  async ngAfterViewInit(): Promise<void> {
    try {
      await this.load();
      const mine = this.start ? null : await this.locate().catch(() => null);
      const centre = CarpoolMapPickComponent.firstCentre(this.start, mine);
      this.map = new google.maps.Map(this.mapEl!.nativeElement, {
        center: centre, zoom: 17, mapId: 'DEMO_MAP_ID', disableDefaultUI: true, gestureHandling: 'greedy', clickableIcons: false,
      });
      this.listeners.push(this.map.addListener('dragstart', () => this.run(() => this.moving())));
      this.listeners.push(this.map.addListener('idle', () => {
        const c = this.map.getCenter();
        void this.settle({ lat: c.lat(), lng: c.lng() });
      }));
    } catch {
      this.run(() => (this.state = 'error'));
    }
  }

  ngOnDestroy(): void {
    this.listeners.forEach((l) => l?.remove?.());
  }

  moving(): void {
    this.seq++;
    this.state = 'finding';
  }

  /** Names the spot under the pin; an answer for an older spot is dropped. */
  async settle(at: MapPoint): Promise<void> {
    const mine = ++this.seq;
    this.at = at;
    this.state = 'finding';
    const found = await this.name(at).catch(() => null);
    if (mine !== this.seq) return;
    this.run(() => {
      this.place = found ?? { name: 'Pinned spot', address: `${at.lat.toFixed(5)}, ${at.lng.toFixed(5)}` };
      this.state = 'ready';
    });
  }

  async goToMe(): Promise<void> {
    const me = await this.locate().catch(() => null);
    if (me && this.map) this.map.panTo(me);
  }

  use(): void {
    if (!this.canUse) return;
    this.picked.emit({ ...this.at!, ...this.place! });
  }

  private run(fn: () => void): void {
    if (this.zone) this.zone.run(fn);
    else fn();
    this.cdr?.markForCheck();
  }
}
