import { Component, OnInit } from '@angular/core';
import { NavController, ViewWillEnter } from '@ionic/angular';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-welcome',
  templateUrl: './welcome.page.html',
  styleUrls: ['./welcome.page.scss'],
  standalone: false
})
export class WelcomePage implements OnInit, ViewWillEnter {

  constructor(
    private auth: AuthService,
    private navCtrl: NavController,
  ) { }

  ngOnInit() {
  }

  ionViewWillEnter(): void {
    if (this.auth.isLoggedIn()) {
      void this.navCtrl.navigateRoot('/tabs/dashboard', { animationDirection: 'forward' });
    }
  }

  useFallbackImage(event: any) {
    // If the image is not found, replace it with a styled div dynamically or hide it
    event.target.style.display = 'none';
    const parent = event.target.parentElement;
    if (parent) {
      const fallback = document.createElement('div');
      fallback.className = 'fallback-img';
      fallback.innerText = 'Illustration Placeholder';
      parent.appendChild(fallback);
    }
  }

  goToLogin() {
    void this.navCtrl.navigateForward('/auth/login');
  }

  goToTerms() {
    console.log('Navigate to Terms');
  }

  goToPrivacy() {
    console.log('Navigate to Privacy');
  }
}

