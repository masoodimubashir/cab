import { Component, OnDestroy } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { Subscription, merge, of } from 'rxjs';
import { catchError, filter, switchMap } from 'rxjs/operators';
import { CarpoolApiService } from '../carpool-api.service';

/**
 * Carpool driver footer: Home · Carpools · Inbox · Profile (Carpool.md section 2).
 * The Inbox badge counts waiting join requests (messages join it with M5).
 */
@Component({
  selector: 'app-carpool-tabs',
  template: `
    <ion-tabs>
      <ion-tab-bar slot="bottom" class="cp-nav">
        <ion-tab-button tab="home"><ion-icon name="home-outline"></ion-icon><ion-label>Home</ion-label></ion-tab-button>
        <ion-tab-button tab="carpools"><ion-icon name="car-outline"></ion-icon><ion-label>Carpools</ion-label></ion-tab-button>
        <ion-tab-button tab="inbox">
          <span class="count" *ngIf="count" [attr.aria-label]="count + ' waiting'">{{ count > 99 ? '99+' : count }}</span>
          <ion-icon name="chatbubbles-outline"></ion-icon><ion-label>Inbox</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="profile"><ion-icon name="person-outline"></ion-icon><ion-label>Profile</ion-label></ion-tab-button>
      </ion-tab-bar>
    </ion-tabs>
  `,
  styles: [`
    .cp-nav { --background: #fff; --border: 1px solid #e4e9ef; --color: #5a6a80; --color-selected: #087f50; height: calc(66px + var(--ion-safe-area-bottom, 0px)); padding: 8px 12px calc(10px + var(--ion-safe-area-bottom, 0px)); font-family: Roboto, "Segoe UI", system-ui, sans-serif; }
    ion-tab-button { position: relative; min-height: 48px; --padding-top: 0; --padding-bottom: 0; --padding-start: 0; --padding-end: 0; --ripple-color: transparent; letter-spacing: normal; }
    ion-tab-button ion-icon { font-size: 23px; margin: 0; }
    ion-tab-button ion-label { margin: 4px 0 0; font-size: 12px; font-weight: 400; letter-spacing: normal; text-transform: none; }
    ion-tab-button.tab-selected ion-label { font-weight: 700; }
    .count { position: absolute; top: 0; left: calc(50% + 6px); z-index: 1; min-width: 18px; height: 18px; padding: 0 5px; display: grid; place-items: center; border-radius: 10px; background: #087f50; color: #fff; font-size: 12px; font-weight: 700; line-height: 1; }
  `],
  standalone: false,
})
export class CarpoolTabsPage implements OnDestroy {
  count = 0;
  private sub: Subscription;

  constructor(router: Router, carpool: CarpoolApiService) {
    this.sub = merge(
      router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd && e.urlAfterRedirects.startsWith('/carpool'))),
      carpool.answered$,
    )
      .pipe(
        switchMap(() => carpool.inboxCount().pipe(catchError(() => of(this.count)))),
      )
      .subscribe((n) => (this.count = n));
    carpool.inboxCount().subscribe({ next: (n) => (this.count = n), error: () => undefined });
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
  }
}
