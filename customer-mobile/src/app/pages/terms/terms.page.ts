import { Component } from '@angular/core';
import { NavController } from '@ionic/angular';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-terms',
  templateUrl: './terms.page.html',
  styleUrls: ['./terms.page.scss'],
  standalone: false,
})
export class TermsPage {
  lastUpdated = 'March 2025 (v2.4 - DPDP & Consumer Protection Compliant)';

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
    window.location.href = `mailto:${email}?subject=Passenger%20Legal%20Inquiry%20-%20Terms`;
  }
}
