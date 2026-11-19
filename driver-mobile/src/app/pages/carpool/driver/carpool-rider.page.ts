import { Component } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { NavController } from '@ionic/angular';
import { CarpoolApiService } from '../carpool-api.service';
import { CarpoolRiderProfile } from '../carpool.models';
import { clock } from './carpool-format';

/**
 * Rider profile (driver mockup 8c), opened from Profile in a rider's options.
 * What the driver needs to trust a rider: checks, carpools taken, and this
 * carpool's pickup and drop. The phone number is never shown. Report comes
 * with M5; there is no rider rating (P11).
 */
@Component({
  selector: 'app-carpool-rider',
  template: `
    <ion-content class="cp">
      <div class="cp-wrap hm">
        <div class="d-head" style="margin-bottom: 4px"><button class="icon-btn" aria-label="Back" (click)="back()"><ion-icon name="chevron-back-outline"></ion-icon></button><span class="grow"></span></div>
        <div class="center" *ngIf="!p && !error"><ion-spinner name="crescent"></ion-spinner></div>
        <div class="errbar" role="alert" *ngIf="error">
          <ion-icon name="alert-circle-outline"></ion-icon>
          <span class="grow"><b>Couldn't load this rider</b><small>Check your connection.</small></span>
          <button class="d-btn line mini" (click)="load()">Try again</button>
        </div>
        <ng-container *ngIf="p">
          <div class="pf-hero" style="margin-bottom: 0">
            <span class="av" [style.background-image]="p.rider.photo_url ? 'url(' + p.rider.photo_url + ')' : null" [style.background-size]="'cover'" [style.background-position]="'center'">{{ p.rider.photo_url ? '' : p.rider.initials }}</span>
            <h1>{{ p.rider.name }}</h1>
            <p class="t13 muted" *ngIf="joined">Joined {{ joined }}</p>
          </div>
          <div class="d-card" style="margin-top: 18px; padding: 2px 14px">
            <div class="chk" *ngIf="p.profile.phone_verified"><ion-icon name="checkmark-circle"></ion-icon>Phone number verified</div>
            <div class="chk" *ngIf="p.profile.photo_added"><ion-icon name="checkmark-circle"></ion-icon>Profile photo added</div>
            <div class="chk"><ion-icon class="muted" name="people-outline"></ion-icon>{{ p.profile.carpools_taken }} {{ p.profile.carpools_taken === 1 ? 'carpool' : 'carpools' }} taken</div>
          </div>
          <h2 class="d-h">On this carpool</h2>
          <div class="d-card">
            <div class="rt">
              <span class="rail"><i></i><b></b><i class="end"></i></span>
              <span><span class="label">Pickup, about {{ clock(p.pickup.at) }}</span>{{ p.pickup.name }}</span>
              <span><span class="label">Drop</span>{{ p.drop.name }}</span>
            </div>
            <p class="t12 muted" style="margin-top: 10px">{{ p.seats }} {{ p.seats === 1 ? 'seat' : 'seats' }} · {{ p.is_free ? 'Free ride' : '₹' + p.total }} · {{ statusWord }}</p>
          </div>
          <button class="d-btn redline" *ngIf="p.chat_id" style="width: 100%; margin-top: 18px; min-height: 48px" (click)="report()">Report {{ p.rider.first_name }}</button>
        </ng-container>
      </div>
    </ion-content>
  `,
  styleUrls: ['./carpool-driver.scss'],
  standalone: false,
})
export class CarpoolRiderPage {
  p: CarpoolRiderProfile | null = null;
  error = false;
  readonly clock = clock;

  /** Opens the private chat with the report sheet up (mockup 8e). */
  report(): void {
    if (this.p?.chat_id) void this.nav.navigateForward(`/carpool/chat/${this.p.chat_id}`, { queryParams: { report: 1 } });
  }
  private listingId = 0;
  private requestId = 0;

  constructor(private route: ActivatedRoute, private nav: NavController, private carpool: CarpoolApiService) {}

  ionViewWillEnter(): void {
    this.listingId = Number(this.route.snapshot.paramMap.get('id'));
    this.requestId = Number(this.route.snapshot.paramMap.get('requestId'));
    this.load();
  }

  load(): void {
    this.error = false;
    this.carpool.joinRequest(this.requestId).subscribe({
      next: (p) => (this.p = p),
      error: () => (this.error = true),
    });
  }

  /** "October 2026". */
  get joined(): string {
    const j = this.p?.profile.joined;
    return j ? new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${j}-15T12:00:00Z`)) : '';
  }

  get statusWord(): string {
    switch (this.p?.status) {
      case 'accepted': return 'Joined';
      case 'pending': return 'Waiting for your answer';
      case 'removed': return 'Removed';
      case 'cancelled_by_rider': return 'Left';
      default: return '';
    }
  }

  back(): void {
    void this.nav.navigateBack(`/carpool/listing/${this.listingId}`);
  }
}
