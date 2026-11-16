import { Component, OnInit, ViewChild } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import {
  ActionSheetController,
  AlertController,
  IonRouterOutlet,
  MenuController,
  ModalController,
  NavController,
  Platform,
  PopoverController,
  ToastController,
} from '@ionic/angular';
import { Location } from '@angular/common';
import { filter } from 'rxjs/operators';
import { App as CapacitorApp } from '@capacitor/app';
import { AuthService } from './core/auth.service';
import { PushService } from './core/push.service';
import { GeolocationService } from './core/geolocation.service';
import { AppAssetService } from './core/app-asset.service';
import { BookingService } from './pages/booking/booking.service';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent implements OnInit {
  get showPreviewCityButton(): boolean { return this.geo.localPreviewEnabled; }
  previewCitiesLoading = false;

  async changePreviewCity(): Promise<void> {
    if (!this.showPreviewCityButton || this.previewCitiesLoading) return;
    this.previewCitiesLoading = true;
    try {
      const cities = (await this.booking.cities()).filter(city => city.center_lat != null && city.center_lng != null
        && Number.isFinite(Number(city.center_lat)) && Number.isFinite(Number(city.center_lng)));
      const alert = await this.alertCtrl.create({
        header: 'Development city',
        message: 'Select a test location. Home reloads with this location across the app.',
        inputs: [
          { type: 'radio', label: 'Use device GPS', value: 'gps' },
          ...cities.map(city => ({ type: 'radio' as const, label: city.name, value: String(city.id) })),
        ],
        buttons: [
          { text: 'Cancel', role: 'cancel' },
          { text: 'Apply', handler: (id: string) => {
            if (id === 'gps') { this.geo.setPreviewCity(null); return; }
            const city = cities.find(item => String(item.id) === id);
            if (!city) return false;
            this.geo.setPreviewCity({ name: city.name, lat: Number(city.center_lat), lng: Number(city.center_lng) });
            return;
          } },
        ],
      });
      await alert.present();
    } catch {
      const toast = await this.toastCtrl.create({ message: 'Could not load preview cities. Try again.', duration: 3000 });
      await toast.present();
    } finally { this.previewCitiesLoading = false; }
  }
  @ViewChild(IonRouterOutlet, { static: false }) routerOutlet?: IonRouterOutlet;

  private lastBackPress = 0;
  private backToast: HTMLIonToastElement | null = null;
  private routeHistory: string[] = [];

  constructor(
    private auth: AuthService,
    private push: PushService,
    private geo: GeolocationService,
    private platform: Platform,
    private router: Router,
    private navCtrl: NavController,
    private location: Location,
    private toastCtrl: ToastController,
    private modalCtrl: ModalController,
    private alertCtrl: AlertController,
    private actionSheetCtrl: ActionSheetController,
    private popoverCtrl: PopoverController,
    private menuCtrl: MenuController,
    private appAssets: AppAssetService,
    private booking: BookingService,
  ) {}

  ngOnInit(): void {
    this.appAssets.loadCustomerMarker();
    if (this.auth.isLoggedIn()) {
      void this.push.registerForUser();
      void this.geo.getCurrentPosition();
    }

    this.trackNavigationHistory();
    this.setupBackButton();
  }

  private trackNavigationHistory(): void {
    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event) => {
        const url = event.urlAfterRedirects || event.url;
        if (!url || url.includes('/splash')) return;

        const cleanUrl = url.split('?')[0].split('#')[0];

        // If navigating to Home root, reset stack with home as root
        if (cleanUrl === '/customer-tabs/go' || cleanUrl === '/customer-tabs/book' || cleanUrl === '/customer-tabs') {
          this.routeHistory = ['/customer-tabs/go'];
          return;
        }

        const last = this.routeHistory[this.routeHistory.length - 1];
        if (last === cleanUrl) return;

        // Truncate or append
        const existingIdx = this.routeHistory.indexOf(cleanUrl);
        if (existingIdx !== -1) {
          this.routeHistory = this.routeHistory.slice(0, existingIdx + 1);
        } else {
          this.routeHistory.push(cleanUrl);
        }
      });
  }

  private setupBackButton(): void {
    this.platform.backButton.subscribeWithPriority(10, async () => {
      // 1. Close any open overlays first (Modal, Alert, ActionSheet, Popover, SideMenu)
      const modal = await this.modalCtrl.getTop();
      if (modal) {
        await modal.dismiss();
        return;
      }
      const alert = await this.alertCtrl.getTop();
      if (alert) {
        await alert.dismiss();
        return;
      }
      const actionSheet = await this.actionSheetCtrl.getTop();
      if (actionSheet) {
        await actionSheet.dismiss();
        return;
      }
      const popover = await this.popoverCtrl.getTop();
      if (popover) {
        await popover.dismiss();
        return;
      }
      if (await this.menuCtrl.isOpen()) {
        await this.menuCtrl.close();
        return;
      }

      const currentUrl = (this.router.url || '').split('?')[0].split('#')[0];

      // 2. Identify root landing routes where back should exit/minimize instead of popping
      const isHomeRoot =
        currentUrl === '/customer-tabs/go' ||
        currentUrl === '/customer-tabs/book' ||
        currentUrl === '/customer-tabs';

      const isGuestRoot =
        currentUrl === '/welcome' ||
        currentUrl === '/auth/login' ||
        currentUrl === '/intro' ||
        currentUrl === '/splash' ||
        currentUrl === '/' ||
        currentUrl === '';

      if (isHomeRoot || isGuestRoot) {
        await this.handleExit();
        return;
      }

      // 3. Step back sequentially through navigation stack (D -> C -> B -> A)
      if (this.routeHistory.length > 1) {
        this.routeHistory.pop(); // Remove current
        const prevUrl = this.routeHistory[this.routeHistory.length - 1];
        if (prevUrl) {
          void this.navCtrl.navigateBack(prevUrl, { animated: true });
          return;
        }
      }

      // 4. Fallback outlet or router history
      if (this.routerOutlet?.canGoBack()) {
        this.routerOutlet.pop();
        return;
      }

      // 5. Final fallback to Home root
      if (this.auth.isLoggedIn()) {
        this.routeHistory = ['/customer-tabs/go'];
        void this.navCtrl.navigateRoot('/customer-tabs/go', { animationDirection: 'back' });
      } else {
        await this.handleExit();
      }
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

