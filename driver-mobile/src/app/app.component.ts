import { Component, OnInit, ViewChild } from '@angular/core';
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

  // Startup routing (session check + active-trip resume) lives in the splash
  // page, which is the app's root route — see pages/splash/splash.page.ts.
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
      const isDashboardRoot =
        url === '/tabs/dashboard' ||
        url === '/tabs' ||
        url.startsWith('/tabs/dashboard?');

      const isLockedOrGuestRoot =
        url === '/driver-pending-review' ||
        url === '/welcome' ||
        url === '/auth/login' ||
        url === '/intro' ||
        url === '/splash' ||
        url === '/';

      if (isDashboardRoot || isLockedOrGuestRoot) {
        await this.handleExit();
        return;
      }

      // If user is inside another top-level tab (like rides, earnings, wallet, history, more), return to dashboard
      if (
        url.startsWith('/tabs/rides') ||
        url.startsWith('/tabs/earnings') ||
        url.startsWith('/tabs/wallet') ||
        url.startsWith('/tabs/history') ||
        url.startsWith('/tabs/scheduled') ||
        url.startsWith('/tabs/fixed') ||
        url.startsWith('/tabs/more')
      ) {
        void this.navCtrl.navigateRoot('/tabs/dashboard', { animationDirection: 'back' });
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

