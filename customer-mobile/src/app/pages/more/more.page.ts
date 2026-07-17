import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController } from '@ionic/angular';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';

/**
 * Customer "More" tab — header card with name + role, then links to
 * Profile, Saved Locations, Emergency Contacts, and Sign out.
 * Mirrors the driver-mobile More page layout.
 */
@Component({
  selector: 'app-customer-more',
  templateUrl: './more.page.html',
  styleUrls: ['./more.page.scss'],
  standalone: false,
})
export class CustomerMorePage {
  constructor(
    public auth: AuthService,
    private api: ApiService,
    private router: Router,
    private alertCtrl: AlertController,
  ) {}

  get roleLabel(): string {
    const u = this.auth.getUser();
    if (!u) return '';
    if (Array.isArray(u.roles) && u.roles.length) return u.roles.join(', ');
    return u.role || '';
  }

  goProfile(): void { this.router.navigateByUrl('/customer-tabs/profile'); }
  goSavedLocations(): void { this.router.navigateByUrl('/customer-tabs/saved-locations'); }
  goEmergencyContacts(): void { this.router.navigateByUrl('/customer-tabs/emergency-contacts'); }
  goCoupons(): void { this.router.navigateByUrl('/customer-tabs/coupons'); }
  goRefunds(): void { this.router.navigateByUrl('/customer-tabs/refunds'); }

  async signOut(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Sign out?',
      message: 'You will need to sign in again to book a ride.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Sign out', role: 'destructive', handler: () => this.performSignOut() },
      ],
    });
    await alert.present();
  }

  private performSignOut(): void {
    this.api.post('/me/logout', {}).subscribe({
      next: () => this.finishSignOut(),
      error: () => this.finishSignOut(),
    });
  }

  private finishSignOut(): void {
    this.auth.logout();
    this.router.navigateByUrl('/auth/login', { replaceUrl: true });
  }
}
