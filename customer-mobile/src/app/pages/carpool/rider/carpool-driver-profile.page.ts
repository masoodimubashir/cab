import { Component } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { NavController } from '@ionic/angular';
import { CarpoolApiService } from '../carpool-api.service';
import { CarpoolRide } from '../carpool.models';

/**
 * Driver profile (customer mockup 4c), opened from the driver card on the
 * carpool page. The checks and the car with its plate, so the rider can spot
 * it. The rating shows once rider-to-driver ratings are on (M6); Report comes
 * with M5.
 */
@Component({
  selector: 'app-carpool-driver-profile',
  template: `
    <ion-content class="cr">
      <div class="cr-wrap">
        <div class="c-bar"><button class="icon-btn ring" aria-label="Back" (click)="back()"><ion-icon name="chevron-back-outline"></ion-icon></button><span class="grow"></span></div>
        <div class="center" *ngIf="!ride && !error"><ion-spinner name="crescent"></ion-spinner></div>
        <p class="errbar" role="alert" *ngIf="error"><ion-icon name="alert-circle-outline"></ion-icon><span class="grow"><b>Couldn't load the driver</b><small>Check your connection.</small></span><button class="c-go line mini" (click)="load()">Try again</button></p>
        <ng-container *ngIf="ride">
          <div class="pf-hero">
            <span class="av">{{ ride.driver.initials }}</span>
            <h1>{{ ride.driver.name }}</h1>
            <p class="stars" *ngIf="ride.driver.rating !== null"><ion-icon name="star"></ion-icon>{{ ride.driver.rating }} <span class="t13 muted" style="font-weight: 400">· {{ ride.driver.rating_count }} ratings</span></p>
          </div>
          <div class="c-card checks">
            <div class="chk"><ion-icon name="shield-checkmark-outline"></ion-icon>Checked by Dream Cabs</div>
            <div class="chk"><ion-icon name="checkmark-circle"></ion-icon>Phone number verified</div>
            <div class="chk" *ngIf="ride.driver.carpools_driven > 0"><ion-icon class="muted" name="car-outline"></ion-icon>{{ drivenLine }}</div>
          </div>
          <div class="c-card" *ngIf="ride.car">
            <div class="carph">
              <img *ngIf="ride.car.photo_url; else carIcon" [src]="ride.car.photo_url" [alt]="ride.car.label">
              <ng-template #carIcon><ion-icon name="car-sport-outline"></ion-icon></ng-template>
            </div>
            <div class="split" style="align-items: center; margin-top: 12px">
              <div><h3>{{ ride.car.label }}</h3><p class="t12 muted">{{ ride.car.seats }} seats</p></div>
              <span class="plate">{{ ride.car.plate }}</span>
            </div>
          </div>
        </ng-container>
      </div>
    </ion-content>
  `,
  styleUrls: ['./carpool-rider.scss'],
  standalone: false,
})
export class CarpoolDriverProfilePage {
  ride: CarpoolRide | null = null;
  error = false;
  private id = 0;

  constructor(private route: ActivatedRoute, private nav: NavController, private carpool: CarpoolApiService) {}

  ionViewWillEnter(): void {
    this.id = Number(this.route.snapshot.paramMap.get('id'));
    this.load();
  }

  load(): void {
    this.error = false;
    this.carpool.ride(this.id).subscribe({
      next: (r) => (this.ride = r),
      error: () => (this.error = true),
    });
  }

  /** "41 carpools driven since August". */
  get drivenLine(): string {
    const d = this.ride?.driver;
    if (!d) return '';
    const n = `${d.carpools_driven} ${d.carpools_driven === 1 ? 'carpool' : 'carpools'} driven`;
    if (!d.since) return n;
    const month = new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' }).format(new Date(`${d.since}-15T12:00:00Z`));
    return `${n} since ${month}`;
  }

  back(): void {
    this.nav.navigateBack(['/carpool/ride', this.id], { queryParams: this.route.snapshot.queryParams });
  }
}
