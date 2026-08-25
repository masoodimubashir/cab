import { Component, OnInit } from '@angular/core';
import { NavController } from '@ionic/angular';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-splash',
  templateUrl: './splash.page.html',
  styleUrls: ['./splash.page.scss'],
  standalone: false,
})
export class SplashPage implements OnInit {
  constructor(
    private auth: AuthService,
    private navCtrl: NavController
  ) {}

  private homeRouteForCurrentUser(): string {
    return '/customer-tabs/go';
  }

  ngOnInit() {
    // Beautiful immersive delay to show the cinematic entrance animation,
    // and then route the session securely.
    setTimeout(() => {
      if (this.auth.isLoggedIn()) {
        void this.navCtrl.navigateRoot(this.homeRouteForCurrentUser(), { animationDirection: 'forward' });
      } else {
        void this.navCtrl.navigateRoot('/welcome', { animationDirection: 'forward' });
      }
    }, 2500);
  }
}

