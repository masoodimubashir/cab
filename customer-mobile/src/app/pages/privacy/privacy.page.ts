import { Component } from '@angular/core';
import { NavController } from '@ionic/angular';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-privacy',
  templateUrl: './privacy.page.html',
  styleUrls: ['./privacy.page.scss'],
  standalone: false,
})
export class PrivacyPage {
  lastUpdated = '8 September 2026';

  constructor(
    private navCtrl: NavController,
    private auth: AuthService,
  ) {}

  goBack(): void {
    if (window.history.length > 1) {
      this.navCtrl.back();
    } else if (this.auth.isLoggedIn()) {
      this.navCtrl.navigateRoot('/customer-tabs/go');
    } else {
      this.navCtrl.navigateRoot('/welcome');
    }
  }

  openEmail(email = 'dreamcabs2025@gmail.com'): void {
    window.location.href = `mailto:${email}?subject=Passenger%20Privacy%20%26%20Data%20Inquiry`;
  }
}
