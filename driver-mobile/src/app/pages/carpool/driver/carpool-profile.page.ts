import { Component } from '@angular/core';
import { NavController } from '@ionic/angular';
import { ApiService } from '../../../core/api.service';
import { AuthService } from '../../../core/auth.service';
import { CarpoolApiService } from '../carpool-api.service';

interface Me {
  user?: { name?: string; phone?: string };
  driver?: { carpool_vehicle?: { make: string; model: string; colour: string; plate: string; seats: number } | null };
}

/**
 * Profile tab ("Driver: Profile" in the mockup): Plans moved here from its own
 * tab, plus support, terms, privacy and delete account, since car owners have
 * no More tab.
 */
@Component({
  selector: 'app-carpool-profile',
  template: `
    <ion-content class="cp">
      <div class="cp-wrap hm">
        <div class="pf-hero">
          <span class="av">{{ initials || '?' }}</span>
          <h1>{{ name }}</h1>
          <p class="t13 muted" *ngIf="phone">{{ phone }}</p>
        </div>

        <div class="d-card row" *ngIf="car" style="margin-bottom: 12px">
          <span class="d-tile"><ion-icon name="car-outline"></ion-icon></span>
          <span class="grow"><span class="d-title">{{ car }}</span><br><span class="t12 muted">{{ carLine }}</span></span>
        </div>

        <div class="menu">
          <button routerLink="/carpool-signup/plans"><ion-icon name="card-outline"></ion-icon><span class="grow">Plans<small>Your plan and buying the next one</small></span><ion-icon name="chevron-forward-outline"></ion-icon></button>
          <button routerLink="/notifications"><ion-icon name="notifications-outline"></ion-icon><span class="grow">Notifications</span><ion-icon name="chevron-forward-outline"></ion-icon></button>
        </div>
        <div class="menu">
          <button routerLink="/support"><ion-icon name="help-circle-outline"></ion-icon><span class="grow">Help and support</span><ion-icon name="chevron-forward-outline"></ion-icon></button>
          <button routerLink="/terms"><ion-icon name="document-text-outline"></ion-icon><span class="grow">Terms</span><ion-icon name="chevron-forward-outline"></ion-icon></button>
          <button routerLink="/privacy"><ion-icon name="shield-checkmark-outline"></ion-icon><span class="grow">Privacy</span><ion-icon name="chevron-forward-outline"></ion-icon></button>
          <button routerLink="/delete-account"><ion-icon name="trash-outline"></ion-icon><span class="grow">Delete account</span><ion-icon name="chevron-forward-outline"></ion-icon></button>
        </div>
        <div class="menu">
          <button (click)="logout()"><ion-icon name="log-out-outline"></ion-icon><span class="grow">Log out</span></button>
        </div>
      </div>
    </ion-content>
  `,
  styleUrls: ['./carpool-driver.scss'],
  standalone: false,
})
export class CarpoolProfilePage {
  name = '';
  initials = '';
  phone = '';
  car = '';
  carLine = '';

  constructor(
    private api: ApiService,
    private auth: AuthService,
    private carpool: CarpoolApiService,
    private nav: NavController,
  ) {}

  ionViewWillEnter(): void {
    this.api.get<Me>('/drivers/me').subscribe({
      next: (me) => {
        const full = (me.user?.name ?? '').trim();
        this.name = full;
        this.initials = full.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
        this.phone = me.user?.phone ?? '';
        const v = me.driver?.carpool_vehicle;
        this.car = v ? `${v.colour} ${v.make} ${v.model}` : '';
        this.carLine = v ? `${v.plate} · ${v.seats} seats` : '';
      },
    });
  }

  logout(): void {
    this.carpool.reset();
    void this.auth.logout().then(() => this.nav.navigateRoot('/welcome', { animationDirection: 'back' }));
  }
}
