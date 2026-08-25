import { Component, NgZone, OnInit } from '@angular/core';
import { NavController, ViewDidEnter } from '@ionic/angular';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-splash',
  templateUrl: './splash.page.html',
  styleUrls: ['./splash.page.scss'],
  standalone: false,
})
export class SplashPage implements OnInit, ViewDidEnter {
  private routed = false;

  constructor(
    private auth: AuthService,
    private navCtrl: NavController,
    private zone: NgZone,
  ) {}

  ngOnInit() {
    this.scheduleRoute(2000);
  }

  ionViewDidEnter() {
    if (!this.routed) {
      this.scheduleRoute(1500);
    }
  }

  private scheduleRoute(delayMs: number): void {
    setTimeout(() => {
      this.zone.run(() => this.route());
    }, delayMs);
  }

  private route(): void {
    if (this.routed) return;
    this.routed = true;

    if (this.auth.isLoggedIn()) {
      void this.navCtrl.navigateRoot('/tabs/dashboard', { animationDirection: 'forward' });
    } else {
      void this.navCtrl.navigateRoot('/welcome', { animationDirection: 'forward' });
    }
  }
}
