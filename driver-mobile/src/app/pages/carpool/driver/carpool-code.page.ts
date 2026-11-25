import { Component } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { NavController } from '@ionic/angular';
import { CarpoolApiService } from '../carpool-api.service';
import { CarpoolRiderProfile } from '../carpool.models';
import { clock } from './carpool-format';

type Step = 'enter' | 'wrong' | 'right' | 'done';

/**
 * Check code and pick up (driver mockup 11 and 11b). One rider at a time, at
 * their own pickup. The code is required: there is no photo-only check, no
 * bypass and no manual confirmation (Carpool.md, decided 2026-11-13). A wrong
 * code turns the boxes red and counts a try; after the allowed tries checking
 * locks for a few minutes (proposed in the mockup, not yet decided).
 */
@Component({
  selector: 'app-carpool-code',
  template: `
    <ion-content class="cp">
      <div class="cp-wrap hm">
        <div class="d-head" style="margin-bottom: 8px">
          <button class="icon-btn" aria-label="Back" (click)="back()"><ion-icon name="chevron-back-outline"></ion-icon></button>
          <h1>Pick up {{ p?.rider?.first_name }}</h1>
        </div>
        <div class="center" *ngIf="!p && !error"><ion-spinner name="crescent"></ion-spinner></div>
        <div class="errbar" role="alert" *ngIf="error">
          <ion-icon name="alert-circle-outline"></ion-icon>
          <span class="grow"><b>Couldn't load this rider</b><small>Check your connection.</small></span>
          <button class="d-btn line mini" (click)="load()">Try again</button>
        </div>

        <ng-container *ngIf="p">
          <span class="photo big" [style.background-image]="p.rider.photo_url ? 'url(' + p.rider.photo_url + ')' : null">{{ p.rider.photo_url ? '' : p.rider.initials }}</span>
          <p class="d-title" style="text-align: center; margin-top: 12px; font-size: 17px">{{ p.rider.name }}</p>
          <p class="t13 muted" style="text-align: center">{{ p.seats }} {{ p.seats === 1 ? 'seat' : 'seats' }} · {{ p.pickup.name }}</p>

          <ng-container *ngIf="step !== 'done'">
            <p class="t13" style="text-align: center; margin-top: 22px" *ngIf="step === 'enter'">Ask {{ p.rider.first_name }} for the 4-digit code in the app, and check the face matches the photo.</p>
            <label class="code" [class.bad]="step === 'wrong'" [class.ok]="step === 'right'" (click)="field.focus()">
              <span *ngFor="let i of [0, 1, 2, 3]" [class.cur]="step === 'enter' && !locked && i === digits.length">{{ digits[i] || '' }}</span>
            </label>
            <input #field class="code-in" inputmode="numeric" autocomplete="one-time-code" maxlength="4" aria-label="4-digit code"
                   [value]="digits" [disabled]="step === 'right' || busy || locked" (input)="onInput($any($event.target).value)">

            <p class="t13 muted" style="text-align: center" *ngIf="step === 'enter' && !locked">Code matches only {{ p.rider.first_name }}'s request</p>
            <p class="ok-line" *ngIf="step === 'right'"><ion-icon name="checkmark-circle"></ion-icon>Code is correct</p>
            <ng-container *ngIf="step === 'wrong' && !locked">
              <p class="row t13 bad-line"><ion-icon name="alert-circle-outline"></ion-icon>That code doesn't match</p>
              <p class="t13 muted" style="text-align: center; margin-top: 6px; line-height: 1.5">Ask {{ p.rider.first_name }} to open the carpool in the app and read the code again.</p>
              <p style="text-align: center; margin-top: 12px"><span class="tries">{{ triesLeft }} {{ triesLeft === 1 ? 'try' : 'tries' }} left</span></p>
            </ng-container>
            <ng-container *ngIf="locked">
              <p class="row t13 bad-line"><ion-icon name="lock-closed-outline"></ion-icon>Too many wrong codes</p>
              <p class="t13 muted" style="text-align: center; margin-top: 6px; line-height: 1.5">Checking is locked until {{ unlockAt }}. Message {{ p.rider.first_name }}, or mark a no-show if they never turn up.</p>
            </ng-container>
            <p class="t12 muted" style="text-align: center; margin-top: 14px; line-height: 1.5">Without the right code, {{ p.rider.first_name }} can't be marked as picked up.</p>
          </ng-container>

          <p class="row t13" *ngIf="step === 'done'" style="justify-content: center; gap: 6px; margin-top: 22px; font-weight: 700">
            <ion-icon name="checkmark-circle" style="font-size: 20px; color: var(--cp-green)"></ion-icon>{{ doneLine }}
          </p>
          <div class="errbar" role="alert" *ngIf="failure" style="margin-top: 14px">
            <ion-icon name="alert-circle-outline"></ion-icon>
            <span class="grow"><b>{{ failure }}</b></span>
          </div>
        </ng-container>
      </div>
    </ion-content>
    <ion-footer class="ion-no-border" *ngIf="p">
      <div class="d-dock">
        <ng-container *ngIf="step === 'enter'">
          <button class="d-go" [disabled]="digits.length < 4 || busy || locked" (click)="check()">
            <ion-spinner name="crescent" *ngIf="busy"></ion-spinner>{{ busy ? 'Checking…' : 'Check code' }}
          </button>
        </ng-container>
        <ng-container *ngIf="step === 'wrong'">
          <button class="d-btn line tall" *ngIf="p.chat_id" (click)="message()"><ion-icon name="chatbubble-outline"></ion-icon>Message {{ p.rider.first_name }}</button>
          <button class="d-go" style="flex: 1.3" [disabled]="locked" (click)="retry()">Try again</button>
        </ng-container>
        <ng-container *ngIf="step === 'right'">
          <button class="d-go" [disabled]="busy" (click)="pickUp()">
            <ion-spinner name="crescent" *ngIf="busy"></ion-spinner>{{ busy ? 'Saving…' : 'Mark as picked up' }}
          </button>
        </ng-container>
        <ng-container *ngIf="step === 'done'">
          <button class="d-go" (click)="back()">Back to the ride</button>
        </ng-container>
      </div>
    </ion-footer>
  `,
  styleUrls: ['./carpool-driver.scss'],
  standalone: false,
})
export class CarpoolCodePage {
  p: CarpoolRiderProfile | null = null;
  error = false;
  step: Step = 'enter';
  digits = '';
  busy = false;
  triesLeft = 3;
  lockedUntil: Date | null = null;
  failure: string | null = null;
  readonly clock = clock;

  private listingId = 0;
  private requestId = 0;

  constructor(private route: ActivatedRoute, private nav: NavController, private carpool: CarpoolApiService) {}

  ionViewWillEnter(): void {
    this.listingId = Number(this.route.snapshot.paramMap.get('id'));
    this.requestId = Number(this.route.snapshot.paramMap.get('requestId'));
    this.digits = '';
    this.step = 'enter';
    this.failure = null;
    this.load();
  }

  load(): void {
    this.error = false;
    this.carpool.joinRequest(this.requestId).subscribe({
      next: (p) => {
        this.p = p;
        this.lockedUntil = p.code_locked_until ? new Date(p.code_locked_until) : null;
        if (p.code_verified) this.step = 'right';
        if (p.ride_state === 'picked_up') this.step = 'done';
      },
      error: () => (this.error = true),
    });
  }

  get locked(): boolean {
    return !!this.lockedUntil && this.lockedUntil.getTime() > Date.now();
  }

  get unlockAt(): string {
    return this.lockedUntil ? clock(this.lockedUntil) : '';
  }

  get doneLine(): string {
    return `${this.p?.rider.first_name} is picked up.`;
  }

  onInput(v: string): void {
    this.digits = v.replace(/\D/g, '').slice(0, 4);
    this.failure = null;
    if (this.step === 'wrong') this.step = 'enter';
  }

  check(): void {
    if (this.digits.length < 4 || this.busy || !this.p) return;
    this.busy = true;
    this.failure = null;
    this.carpool.checkCode(this.p.id, this.digits).subscribe({
      next: (r) => {
        this.busy = false;
        this.triesLeft = r.tries_left;
        this.lockedUntil = r.locked_until ? new Date(r.locked_until) : null;
        this.step = r.ok ? 'right' : 'wrong';
        if (r.ok) navigator.vibrate?.(60);
      },
      error: (err) => {
        this.busy = false;
        const msg = err?.error?.errors?.code?.[0] ?? err?.error?.message;
        if (err?.error?.errors?.code) {
          // Locked: the server says until when.
          this.step = 'wrong';
          const until = err?.error?.locked_until;
          if (until) this.lockedUntil = new Date(until);
        }
        this.failure = msg ?? "Couldn't check the code. Check your connection.";
      },
    });
  }

  retry(): void {
    this.digits = '';
    this.step = 'enter';
    this.failure = null;
  }

  pickUp(): void {
    if (!this.p || this.busy) return;
    this.busy = true;
    this.failure = null;
    this.carpool.markPickedUp(this.p.id).subscribe({
      next: () => {
        this.busy = false;
        this.step = 'done';
      },
      error: (err) => {
        this.busy = false;
        this.failure = err?.error?.errors?.code?.[0] ?? err?.error?.errors?.request?.[0] ?? "Couldn't save. Try again.";
      },
    });
  }

  message(): void {
    if (this.p?.chat_id) void this.nav.navigateForward(`/carpool/chat/${this.p.chat_id}`);
  }

  back(): void {
    void this.nav.navigateBack(`/carpool/listing/${this.listingId}`);
  }
}
