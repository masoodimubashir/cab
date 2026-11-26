import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';

/**
 * The ring on the right. num: a number and a word, the arc filled to `fill` (0 to 1).
 * done: a full ring (the trip finished). broken: a dashed ring (it broke off). icon: a faint ring with an icon.
 */
export interface RideRing {
  kind: 'num' | 'done' | 'broken' | 'icon';
  text?: string;
  unit?: string;
  fill?: number;
  icon?: string;
}

/**
 * One state of the ride banner. Tones: go (bright green, on the road and accepted), wait (deep green,
 * upcoming, sent, open), done (soft green, completed and dropped), rare (mid blue, unusual notices),
 * over (deep blue, cancelled or ended). A strip (note) replaces the small line; its button emits `act`.
 */
export interface RideBanner {
  tone: 'go' | 'wait' | 'done' | 'rare' | 'over';
  chip: string;
  live?: boolean;
  title: string;
  route: string;
  line?: string;
  small?: string;
  note?: string;
  noteIcon?: string;
  action?: string;
  ring: RideRing;
}

const C = 2 * Math.PI * 28;

/**
 * W21 ride banner (mockup "Ride banner"): the top of the carpool page in both apps. Always the same
 * height, so the page never jumps when the state changes. Shared by the driver app and the customer
 * app: keep both copies identical.
 */
@Component({
  selector: 'cp-ride-banner',
  standalone: true,
  imports: [CommonModule, IonicModule],
  template: `
    <section class="rb" [ngClass]="b.tone" aria-live="polite">
      <svg class="rb-ring" viewBox="0 0 66 66" aria-hidden="true" [ngSwitch]="b.ring.kind">
        <ng-container *ngSwitchCase="'num'">
          <circle cx="33" cy="33" r="28" class="track"/>
          <circle cx="33" cy="33" r="28" class="arc" [attr.stroke-dasharray]="c" [attr.stroke-dashoffset]="offset" transform="rotate(-90 33 33)"/>
          <text x="33" y="35" class="n">{{ b.ring.text }}</text><text x="33" y="47" class="u">{{ b.ring.unit }}</text>
        </ng-container>
        <circle *ngSwitchCase="'done'" cx="33" cy="33" r="28" class="full"/>
        <circle *ngSwitchCase="'broken'" cx="33" cy="33" r="28" class="dash" transform="rotate(-80 33 33)"/>
        <circle *ngSwitchDefault cx="33" cy="33" r="28" class="track"/>
      </svg>
      <ion-icon *ngIf="b.ring.kind !== 'num' && b.ring.icon" class="rb-ic" [class.bold]="b.ring.icon === 'checkmark' || b.ring.icon === 'close'" [name]="b.ring.icon" aria-hidden="true"></ion-icon>
      <div class="rb-top">
        <span class="rb-chip"><span class="dot" *ngIf="b.live"></span>{{ b.chip }}</span>
        <h2>{{ b.title }}</h2>
        <p class="rb-route">{{ b.route }}</p>
      </div>
      <p class="rb-line" *ngIf="b.line">{{ b.line }}<small *ngIf="b.small && !b.note">{{ b.small }}</small></p>
      <p class="rb-note" *ngIf="b.note">
        <ion-icon [name]="b.noteIcon || 'information-circle-outline'" aria-hidden="true"></ion-icon><span>{{ b.note }}</span>
        <button type="button" *ngIf="b.action" [disabled]="busy" (click)="act.emit()">{{ b.action }}</button>
      </p>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .rb { position: relative; overflow: hidden; display: flex; flex-direction: column; box-sizing: border-box; height: 160px; padding: 14px 16px; border-radius: 20px; color: #fff;
      background: radial-gradient(circle at 18% 10%, #1a9a63 0, #087f50 55%, #06704a 100%); }
    .rb::before { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 70px; pointer-events: none;
      background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 360 70' preserveAspectRatio='none'%3E%3Cpath d='M0 40C60 18 130 20 190 40S300 62 360 30V70H0Z' fill='%23ffffff' fill-opacity='.06'/%3E%3Cpath d='M0 58C80 40 150 44 220 58S320 70 360 56V70H0Z' fill='%23ffffff' fill-opacity='.07'/%3E%3C/svg%3E") bottom/100% 100% no-repeat; }
    .rb.wait { background: radial-gradient(circle at 18% 10%, #1f6b4c 0, #0f5038 60%, #0a3c2a 100%); }
    .rb.done { background: radial-gradient(circle at 18% 10%, #6aa58c 0, #4f8b73 55%, #3f7761 100%); }
    .rb.rare { background: radial-gradient(circle at 18% 10%, #4f7fb8 0, #35659f 55%, #2a5487 100%); }
    .rb.over { background: radial-gradient(circle at 18% 10%, #2d4a74 0, #16294a 60%, #101a2c 100%); }
    .rb-chip { position: relative; align-self: flex-start; display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 14px; background: #ffffffe6; color: #087f50; font-size: 12px; font-weight: 700; }
    .wait .rb-chip { color: #0f5038; } .done .rb-chip { color: #3f7761; } .rare .rb-chip { color: #2a5487; } .over .rb-chip { color: #16294a; }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: #12b35b; box-shadow: 0 0 0 3px #12b35b33; }
    .rb-top { position: relative; display: flex; flex-direction: column; min-width: 0; padding-right: 80px; }
    h2 { margin: 8px 0 0; font-size: 20px; font-weight: 800; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .rb-route { margin: 2px 0 0; font-size: 13px; line-height: 18px; color: #ffffffcc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .rb-line { position: relative; margin: auto 0 0; font-size: 14px; font-weight: 700; line-height: 18px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .rb-line small { display: block; font-size: 12px; font-weight: 400; line-height: 16px; color: #ffffffc7; overflow: hidden; text-overflow: ellipsis; }
    .rb-note { position: relative; display: flex; align-items: center; gap: 8px; min-height: 34px; margin: 6px 0 0; padding: 3px 4px 3px 10px; border-radius: 12px; background: #ffffff1f; font-size: 12.5px; font-weight: 600; }
    .rb-top + .rb-note { margin-top: auto; }
    .rb-note ion-icon { flex: none; font-size: 16px; }
    .rb-note span { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .rb-note button { flex: none; min-height: 28px; padding: 0 12px; border: 0; border-radius: 14px; background: #fff; color: #0d1b2a; font: inherit; font-size: 12px; font-weight: 700; }
    .rb-note button[disabled] { opacity: .6; }
    .rb-ring { position: absolute; right: 14px; top: 14px; width: 66px; height: 66px; }
    .rb-ring circle { fill: none; }
    .rb-ring .track { stroke: #ffffff33; stroke-width: 6; }
    .rb-ring .arc { stroke: #fff; stroke-width: 6; stroke-linecap: round; }
    .rb-ring .full { stroke: #fff; stroke-width: 6; fill: #ffffff1a; }
    .rb-ring .dash { stroke: #ffffffb3; stroke-width: 4; stroke-linecap: round; stroke-dasharray: 7 9; }
    .rb-ring text { fill: #fff; text-anchor: middle; font-family: inherit; }
    .rb-ring .n { font-size: 17px; font-weight: 800; }
    .rb-ring .u { font-size: 9px; }
    .rb-ic { position: absolute; right: 34px; top: 34px; font-size: 26px; color: #fff; }
    .rb-ic.bold { --ionicon-stroke-width: 56px; font-size: 28px; right: 33px; top: 33px; }
    /* Narrow phones (320 px): a long date like "Thu 26 Nov, 10:21 PM" still fits beside the ring. */
    @media (max-width: 359px) { h2 { font-size: 17px; } .rb-top { padding-right: 76px; } }
  `],
})
export class CarpoolRideBannerComponent {
  @Input({ required: true }) b!: RideBanner;
  /** True while the strip's action runs: the button greys out. */
  @Input() busy = false;
  @Output() act = new EventEmitter<void>();

  readonly c = C;

  get offset(): number {
    const f = Math.max(0, Math.min(1, this.b.ring.fill ?? 0));
    return C * (1 - f);
  }
}
