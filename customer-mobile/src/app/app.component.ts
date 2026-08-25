import { Component, OnInit, Optional, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import { IonRouterOutlet, NavController, Platform, ToastController } from '@ionic/angular';
import { App as CapacitorApp } from '@capacitor/app';
import { AuthService } from './core/auth.service';
import { PushService } from './core/push.service';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent implements OnInit {
  @ViewChild(IonRouterOutlet, { static: false }) routerOutlet?: IonRouterOutlet;

  private lastBackPress = 0;
  private backToast: HTMLIonToastElement | null = null;

  constructor(
    private auth: AuthService,
    private push: PushService,
    private platform: Platform,
    private router: Router,
    private navCtrl: NavController,
    private toastCtrl: ToastController,
  ) {}

  ngOnInit(): void {
    // Re-register the FCM device token on every app open (not just at login),
    // so an already-signed-in phone keeps a valid delivery address in the
    // backend — and self-heals if the token was never saved or later rotated.
    // registerForUser() guards its own permission/token/errors, so this is a
    // safe no-op when notifications are denied or Firebase isn't available.
    if (this.auth.isLoggedIn()) {
      void this.push.registerForUser();
    }

    this.setupBackButton();
  }

  private setupBackButton(): void {
    this.platform.backButton.subscribeWithPriority(10, async () => {
      const url = this.router.url;

      // Identify root landing routes where back should exit/minimize instead of popping
      const isHomeRoot =
        url === '/customer-tabs/go' ||
        url === '/customer-tabs/book' ||
        url === '/customer-tabs' ||
        url.startsWith('/customer-tabs/go?');

      const isGuestRoot =
        url === '/welcome' ||
        url === '/auth/login' ||
        url === '/intro' ||
        url === '/splash' ||
        url === '/';

      if (isHomeRoot || isGuestRoot) {
        await this.handleExit();
        return;
      }

      // If user is inside another top-level tab (like my-trips, profile), return to home tab
      if (
        url.startsWith('/customer-tabs/my-trips') ||
        url.startsWith('/customer-tabs/profile') ||
        url.startsWith('/customer-tabs/coupons') ||
        url.startsWith('/customer-tabs/support') ||
        url.startsWith('/customer-tabs/notifications')
      ) {
        void this.navCtrl.navigateRoot('/customer-tabs/go', { animationDirection: 'back' });
        return;
      }

      // If outlet can navigate back to previous screen within a sub-flow
      if (this.routerOutlet?.canGoBack()) {
        this.routerOutlet.pop();
        return;
      }

      // Default fallback for any remaining screens
      await this.handleExit();
    });
  }

  private async handleExit(): Promise<void> {
    const now = Date.now();
    if (now - this.lastBackPress < 2000) {
      if (this.backToast) {
        await this.backToast.dismiss().catch(() => {});
      }
      void CapacitorApp.exitApp();
    } else {
      this.lastBackPress = now;
      this.backToast = await this.toastCtrl.create({
        message: 'Press back again to exit',
        duration: 2000,
        position: 'bottom',
        cssClass: 'dc-exit-toast',
      });
      await this.backToast.present();
    }
  }
}

