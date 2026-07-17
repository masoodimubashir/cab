import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController } from '@ionic/angular';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { PushService } from '../../core/push.service';

@Component({
  selector: 'app-more',
  templateUrl: './more.page.html',
  styleUrls: ['./more.page.scss'],
  standalone: false,
})
export class MorePage {
  constructor(
    public auth: AuthService,
    private api: ApiService,
    private router: Router,
    private alertCtrl: AlertController,
    private push: PushService,
  ) {}

  goProfile(): void {
    this.router.navigateByUrl('/profile');
  }

  goEmergencyContacts(): void {
    this.router.navigateByUrl('/emergency-contacts');
  }

  goSupport(): void {
    this.router.navigateByUrl('/support');
  }

  goDocuments(): void {
    this.router.navigateByUrl('/driver-registration');
  }

  goPerformance(): void {
    this.router.navigateByUrl('/performance');
  }

  goPaymentMethods(): void {
    this.router.navigateByUrl('/payment-methods');
  }

  goSubscriptions(): void {
    this.router.navigateByUrl('/subscriptions');
  }

  goRefunds(): void {
    this.router.navigateByUrl('/refunds');
  }

  async signOut(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Sign out?',
      message: 'You will need to sign in again to go online and accept rides.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Sign out', role: 'destructive', handler: () => this.performSignOut() },
      ],
    });
    await alert.present();
  }

  private async performSignOut(): Promise<void> {
    await this.push.unregister();
    this.api.post('/me/logout', {}).subscribe({
      next: () => this.finishSignOut(),
      error: () => this.finishSignOut(),
    });
  }

  private finishSignOut(): void {
    this.auth.logout();
    this.router.navigateByUrl('/auth/login', { replaceUrl: true });
  }

  async confirmDeleteAccount(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Delete account',
      message: 'You are about to delete your account. Some data will be lost forever.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Continue',
          role: 'destructive',
          handler: () => this.router.navigateByUrl('/delete-account'),
        },
      ],
    });
    await alert.present();
  }
}
