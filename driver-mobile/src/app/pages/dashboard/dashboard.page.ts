import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController, ModalController } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { AuthService, AuthUser } from '../../core/auth.service';
import { DriverPresenceService, PresenceFix } from '../../core/driver-presence.service';
import { GeolocationService } from '../../core/geolocation.service';
import { MapsLoaderService } from '../../core/maps-loader.service';
import { PushService } from '../../core/push.service';
import { ModeSelectModalComponent, DriverMode } from '../../shared/mode-select-modal/mode-select-modal.component';
import { SubscriptionPromptModalComponent } from '../../shared/subscription-prompt-modal/subscription-prompt-modal.component';

declare const google: any;

interface NavItem {
  label: string;
  sub: string;
  icon: string;
  path: string;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

/** Operator-configured subscription prompt (Operator Settings → Subscription). */
interface SubscriptionPrompt {
  enabled: boolean;
  title: string | null;
  desc: string | null;
  button1: string | null;
  button2: string | null;
}

/**
 * Per-(city, vehicle type) wallet gate, served on /drivers/me. When
 * show_low_wallet_alert is on, the driver must hold at least min_driver_balance
 * to go online. Null-safe: a missing config means "no gate".
 */
interface CityVehicleTypeConfig {
  show_low_wallet_alert: boolean;
  min_driver_balance: number;
}

/**
 * Driver Dashboard — full-map home
 * --------------------------------
 * The bottom tab bar is gone; this screen is now the app's home. It is an
 * edge-to-edge Google Map that:
 *   - shows the device's current location with a live "driver puck" marker,
 *   - tracks the driver walking/driving in real time (continuous watchPosition),
 *   - hosts a floating top bar (menu + status), a recenter FAB, a Go Online /
 *     Go Offline bottom sheet, and a slide-in navigation drawer that replaces
 *     every destination the old tab bar used to reach.
 *
 * GPS ownership rule (so we never run two watchers at once):
 *   - OFFLINE  → this page owns a "visual" watch purely to move the marker.
 *   - ONLINE   → DriverPresenceService owns the watch (it also streams to the
 *                dispatcher); its onLocated() feeds the same marker.
 */
@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.page.html',
  styleUrls: ['./dashboard.page.scss'],
  standalone: false,
})
export class DashboardPage implements AfterViewInit, OnDestroy {
  @ViewChild('mapDiv', { static: false }) mapDiv!: ElementRef<HTMLDivElement>;

  loading = false;
  toggling = false;
  error: string | null = null;
  driver: Record<string, unknown> | null = null;

  /**
   * The driver's (city, vehicle type) wallet-gate config from /drivers/me.
   * Null when the server doesn't send one — treated as "no gate".
   */
  cityVehicleTypeConfig: CityVehicleTypeConfig | null = null;
  /** Current wallet balance, used by the go-online gate (₹). */
  walletBalance = 0;

  /**
   * Full-screen cold-start skeleton — covers the whole dashboard (map + top
   * bar + sheet) until BOTH the driver profile and the map are ready, then it
   * fades out to reveal the live screen.
   */
  homeLoading = true;
  private homeLoadStart = Date.now();
  private profileReady = false;
  private mapReady = false;

  /** Left navigation drawer (replaces the removed bottom tab bar). */
  drawerOpen = false;
  /** Recenter FAB busy spinner while we fetch a one-shot fix. */
  locating = false;
  /** True once we've plotted at least one real GPS fix. */
  hasFix = false;
  /** Keep the camera glued to the driver until they pan the map themselves. */
  private followMe = true;

  /** "Online for" session timer shown in the online sheet. */
  onlineElapsed = '00:00';
  private onlineSince: number | null = null;
  private onlineTimer: ReturnType<typeof setInterval> | null = null;

  /** Destinations the drawer exposes — everything the tab bar used to reach. */
  readonly navGroups: NavGroup[] = [
    {
      title: 'Drive',
      items: [
        { label: 'Rides', sub: 'Available & active trips', icon: 'car-outline', path: '/tabs/rides' },
        { label: 'Scheduled rides', sub: 'Upcoming booked trips', icon: 'calendar-outline', path: '/tabs/scheduled' },
        { label: 'Earnings', sub: "Today & this week's income", icon: 'cash-outline', path: '/tabs/earnings' },
        { label: 'Wallet', sub: 'Balance & payouts', icon: 'wallet-outline', path: '/tabs/wallet' },
        { label: 'Trip history', sub: 'Your past rides', icon: 'time-outline', path: '/tabs/history' },
      ],
    },
    {
      title: 'Account',
      items: [
        { label: 'Performance', sub: 'Rating & trip metrics', icon: 'stats-chart-outline', path: '/performance' },
        { label: 'Profile', sub: 'Name, email & photo', icon: 'person-outline', path: '/profile' },
        { label: 'Documents', sub: 'Vehicle details & uploads', icon: 'document-text-outline', path: '/driver-registration' },
        { label: 'Subscriptions', sub: 'Commission-free plans', icon: 'ribbon-outline', path: '/subscriptions' },
        { label: 'Payment methods', sub: 'Cash & Razorpay', icon: 'card-outline', path: '/payment-methods' },
        { label: 'Emergency numbers', sub: 'SOS contacts', icon: 'people-outline', path: '/emergency-contacts' },
        { label: 'Notifications', sub: 'Messages & ride updates', icon: 'notifications-outline', path: '/notifications' },
        { label: 'Help & Support', sub: 'Contact us, FAQ & report', icon: 'help-buoy-outline', path: '/support' },
      ],
    },
  ];

  private map: any | null = null;
  private selfMarker: any | null = null;
  private accuracyCircle: any | null = null;
  private markerHeading: HTMLElement | null = null;
  private visualWatchId: string | null = null;
  private lastPos: { lat: number; lng: number } | null = null;
  // Default map centre (Mumbai) until we have a real fix.
  private readonly defaultCentre = { lat: 19.0760, lng: 72.8777 };

  constructor(
    private api: ApiService,
    public auth: AuthService,
    private presence: DriverPresenceService,
    private mapsLoader: MapsLoaderService,
    private geo: GeolocationService,
    private router: Router,
    private alertCtrl: AlertController,
    private push: PushService,
    private modalCtrl: ModalController,
  ) {
    this.presence.onError((err) => {
      this.error = err.message;
    });
    this.presence.onLocated((fix: PresenceFix) => {
      // Every GPS fix from the online presence watcher lands here — drive the
      // same marker so the driver sees themselves move in real time.
      this.applyFix(fix.lat, fix.lng, fix.accuracy, fix.bearing);
      if (this.error && this.error.toLowerCase().includes('gps')) {
        this.error = null;
      }
    });

    // Safety: never trap the driver behind the skeleton if the map or profile
    // is slow/unavailable (e.g. a pending location-permission prompt).
    setTimeout(() => this.finishHomeLoading(), 6000);
  }

  ionViewWillEnter(): void {
    this.refresh();
  }

  ionViewDidEnter(): void {
    // App-open greeting: the AI mode chooser (Voice / Self), then — if the
    // operator enabled it — the subscription nudge.
    void this.greetOnAppOpen();
  }

  /**
   * Runs the app-open prompts in order: the mode chooser first, then the
   * subscription nudge. The two are independent (each has its own guard) so the
   * subscription prompt still shows even when the mode chooser was already shown
   * this session.
   */
  private async greetOnAppOpen(): Promise<void> {
    await this.maybeShowModePrompt();
    await this.maybeShowSubscriptionPrompt();
  }

  /**
   * Greet the driver on app open with the mode chooser — "Continue with Voice"
   * (the AI voice assistant) or "Continue as Self" (manual). Shown once per app
   * session; the picked mode is remembered so the AI feature can wire in later.
   */
  private async maybeShowModePrompt(): Promise<void> {
    try {
      if (sessionStorage.getItem('dc_mode_prompt_shown') === '1') return;
    } catch { /* sessionStorage unavailable — fall through */ }
    // Mark shown up-front so a slow render can't double-present the greeting.
    try { sessionStorage.setItem('dc_mode_prompt_shown', '1'); } catch { /* ignore */ }

    const modal = await this.modalCtrl.create({
      component: ModeSelectModalComponent,
      cssClass: 'mode-select-modal',
      componentProps: { current: this.readDriverMode() },
    });
    await modal.present();
    const { data } = await modal.onWillDismiss<{ mode?: DriverMode }>();
    if (data?.mode) {
      try { localStorage.setItem('dc_driver_mode', data.mode); } catch { /* ignore */ }
    }
  }

  /**
   * Operator-controlled subscription nudge, shown on app open right after the
   * mode chooser. Off (Operator Settings → Subscription) or already-subscribed
   * = nothing shows. The buttons (admin-labelled) open the Subscriptions screen
   * so the driver can pick a plan.
   */
  /** Shown at most once per app launch (resets on a cold start). */
  private static subPromptShown = false;
  /** Synchronous guard against a concurrent double-fire of the prompt. */
  private subPromptBusy = false;

  private async maybeShowSubscriptionPrompt(): Promise<void> {
    if (DashboardPage.subPromptShown || this.subPromptBusy) return;
    this.subPromptBusy = true;
    try {
      const cfg = await firstValueFrom(
        this.api.get<SubscriptionPrompt>('/operator/subscription-popup'),
      ).catch(() => null);
      if (!cfg?.enabled) return;

      // Don't nag drivers who already hold a plan.
      const sub = await firstValueFrom(
        this.api.get<{ subscription: unknown | null }>('/drivers/me/subscription'),
      ).catch(() => null);
      if (sub?.subscription) return;

      // Mark shown only once we've passed the gates, so a disabled/subscribed
      // state doesn't permanently suppress it for this launch.
      DashboardPage.subPromptShown = true;

      // Full-page modal that mirrors the Subscriptions screen (hero + plan
      // cards); the operator's title/description drive the headline.
      const modal = await this.modalCtrl.create({
        component: SubscriptionPromptModalComponent,
        componentProps: { title: cfg.title, desc: cfg.desc },
      });
      await modal.present();
    } catch {
      /* best-effort prompt — never block the dashboard */
    } finally {
      this.subPromptBusy = false;
    }
  }

  /** The driver's last-picked mode, if any (used to highlight it on reopen). */
  private readDriverMode(): DriverMode | null {
    try {
      const m = localStorage.getItem('dc_driver_mode');
      return m === 'voice' || m === 'self' ? m : null;
    } catch {
      return null;
    }
  }

  async ngAfterViewInit(): Promise<void> {
    try {
      await this.mapsLoader.ensureLoaded();
      this.initMap();
      await this.startLiveTracking();
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      // Map is up (or failed) — release that half of the skeleton gate.
      this.mapReady = true;
      this.maybeFinishHome();
    }
  }

  ionViewWillLeave(): void {
    // Drop the visual-only watch when navigating away. If the driver is online,
    // DriverPresenceService keeps its own watch alive so dispatch still sees us.
    void this.stopVisualWatch();
  }

  ngOnDestroy(): void {
    void this.stopVisualWatch();
    this.stopOnlineTimer();
  }

  // ---------------------------------------------------------------- display --

  get user(): AuthUser | null {
    return this.auth.getUser();
  }
  get firstName(): string {
    const n = this.user?.name?.trim() || 'Driver';
    return n.split(/\s+/)[0];
  }
  get avatarUrl(): string | null {
    return this.auth.resolveAvatarUrl(this.user);
  }
  readonly defaultAvatar = 'assets/default-avatar.svg';
  /** Swap a broken/unreachable avatar for the bundled default image. */
  onAvatarError(ev: Event): void {
    const img = ev.target as HTMLImageElement | null;
    if (img && img.src.indexOf('default-avatar') === -1) {
      img.src = this.defaultAvatar;
    }
  }
  get isApproved(): boolean {
    return this.driver?.['approval_status'] === 'approved';
  }
  get isOnline(): boolean {
    return !!this.driver?.['is_online'];
  }

  // ------------------------------------------------------------------ drawer --

  openDrawer(): void {
    this.drawerOpen = true;
  }
  closeDrawer(): void {
    this.drawerOpen = false;
    // Pick up any status change made on another screen.
    this.refresh();
  }
  navTo(path: string): void {
    this.drawerOpen = false;
    this.router.navigateByUrl(path);
  }

  async confirmGoOffline(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Go offline?',
      message: 'You will stop receiving new ride requests until you go back online.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Go offline', role: 'destructive', handler: () => { void this.goOffline(); } },
      ],
    });
    await alert.present();
  }

  async confirmDeleteAccount(): Promise<void> {
    this.drawerOpen = false;
    const alert = await this.alertCtrl.create({
      header: 'Delete account',
      message: 'You are about to delete your account. Some data will be lost forever.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Continue', role: 'destructive', handler: () => this.router.navigateByUrl('/delete-account') },
      ],
    });
    await alert.present();
  }

  async confirmSignOut(): Promise<void> {
    this.drawerOpen = false;
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
    try {
      await this.push.unregister();
    } catch {
      /* best-effort */
    }
    this.api.post('/me/logout', {}).subscribe({
      next: () => this.finishSignOut(),
      error: () => this.finishSignOut(),
    });
  }

  private finishSignOut(): void {
    this.auth.logout();
    this.router.navigateByUrl('/auth/login', { replaceUrl: true });
  }

  // ----------------------------------------------------------------- profile --

  refresh(): void {
    this.loading = true;
    this.error = null;
    this.api.get<{
      driver: Record<string, unknown> | null;
      user: { name?: string; roles?: string[]; avatar_path?: string | null; avatar_url?: string | null };
      city_vehicle_type_config?: CityVehicleTypeConfig | null;
      wallet_balance?: number | null;
    }>('/drivers/me').subscribe({
      next: (res) => {
        this.driver = res.driver;
        // Wallet gate config for this driver's (city, vehicle type), null-safe.
        this.cityVehicleTypeConfig = res.city_vehicle_type_config ?? null;
        // Prefer a balance served alongside the profile; otherwise the wallet
        // service fetch below keeps walletBalance in sync.
        if (typeof res.wallet_balance === 'number') {
          this.walletBalance = res.wallet_balance;
        }
        this.refreshWalletBalance();
        if (res.user) {
          // Keep the locally-stored user in sync with the server — crucially the
          // avatar, so a photo uploaded anywhere (app or admin) shows up here,
          // in the drawer and on the profile screen.
          this.auth.updateUser({
            name: res.user.name,
            roles: res.user.roles,
            avatar_path: res.user.avatar_path,
            avatar_url: res.user.avatar_url,
          });
        }
        // App may have been reloaded while online — resume the presence stream
        // so dispatch keeps seeing us as Free, and hand GPS ownership to it.
        if (this.driver?.['is_online']) {
          // Hand GPS ownership to the presence service, THEN drop our visual
          // watch — ordered so the two watchers never overlap (otherwise both
          // could emit fixes during the hand-off).
          if (!this.presence.isStreaming()) {
            void this.presence.start().then(() => this.stopVisualWatch());
          } else {
            void this.stopVisualWatch();
          }
          this.startOnlineTimer();
        } else {
          this.stopOnlineTimer();
        }
      },
      error: (err) => {
        this.error = err?.error?.message || 'Could not load driver profile';
        this.driver = null;
        this.profileReady = true;
        this.maybeFinishHome();
      },
      complete: () => {
        this.loading = false;
        this.profileReady = true;
        this.maybeFinishHome();
      },
    });
  }

  /**
   * Keep walletBalance current from the wallet service so the go-online gate
   * always has a fresh figure (the profile endpoint may not carry a balance).
   * Best-effort: a failure leaves the existing value untouched.
   */
  private refreshWalletBalance(): void {
    this.api.get<{ balance?: number }>('/drivers/me/wallet').subscribe({
      next: (res) => {
        if (typeof res?.balance === 'number') this.walletBalance = res.balance;
      },
      error: () => undefined,
    });
  }

  /**
   * Go-online wallet gate. Blocked only when the operator turned the low-wallet
   * alert on for this (city, vehicle type) AND the driver's balance is below the
   * required minimum. No config = no gate.
   */
  canGoOnline(): boolean {
    const cfg = this.cityVehicleTypeConfig;
    if (!cfg || !cfg.show_low_wallet_alert) return true;
    return this.walletBalance >= (cfg.min_driver_balance ?? 0);
  }

  /** The minimum balance the driver must hold to go online (₹). */
  get minDriverBalance(): number {
    return this.cityVehicleTypeConfig?.min_driver_balance ?? 0;
  }

  /**
   * The full-screen skeleton lifts only once BOTH the profile and the map are
   * ready, so the driver never sees a half-loaded dashboard.
   */
  private maybeFinishHome(): void {
    if (this.profileReady && this.mapReady) this.finishHomeLoading();
  }

  /**
   * Fade the skeleton out once everything's ready, keeping it up for a short
   * minimum so it never flashes on a fast load.
   */
  private finishHomeLoading(): void {
    if (!this.homeLoading) return;
    const elapsed = Date.now() - this.homeLoadStart;
    const minMs = 500;
    if (elapsed >= minMs) {
      this.homeLoading = false;
    } else {
      setTimeout(() => (this.homeLoading = false), minMs - elapsed);
    }
  }

  // -------------------------------------------------------------------- map ---

  private initMap(): void {
    if (!this.mapDiv?.nativeElement || this.map) return;
    this.map = new google.maps.Map(this.mapDiv.nativeElement, {
      center: this.defaultCentre,
      zoom: 13,
      // mapId is required for AdvancedMarkerElement. DEMO_MAP_ID is Google's
      // public test id; swap for a styled Cloud-console mapId in production.
      mapId: 'DEMO_MAP_ID',
      disableDefaultUI: true,
      gestureHandling: 'greedy',
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      clickableIcons: false,
    });

    // The moment the driver drags the map, stop auto-following so we don't yank
    // the camera back on the next GPS tick.
    this.map.addListener('dragstart', () => {
      this.followMe = false;
    });

    // Ionic view transitions can render the container 0×0 on the first tick;
    // nudge a resize once the page is laid out or tiles stay blank.
    setTimeout(() => {
      if (this.map) {
        google.maps.event.trigger(this.map, 'resize');
        this.map.setCenter(this.lastPos || this.defaultCentre);
      }
    }, 300);
  }

  private waitForMap(timeoutMs = 5000): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.map) return resolve(true);
      const start = Date.now();
      const tick = () => {
        if (this.map) return resolve(true);
        if (Date.now() - start > timeoutMs) return resolve(false);
        setTimeout(tick, 100);
      };
      tick();
    });
  }

  // -------------------------------------------------------- live tracking ---

  /**
   * Show the driver where they are the instant the map is ready, then keep the
   * marker moving as they do. Runs on every page entry; safe to call repeatedly.
   */
  private async startLiveTracking(): Promise<void> {
    try {
      await this.geo.requestPermissions();
    } catch {
      /* web prompts lazily on first read */
    }

    // One immediate fix so the marker appears without waiting for a watch tick.
    try {
      const fix = await this.geo.getCurrentPosition({
        enableHighAccuracy: true,
        maximumAge: 4000,
        timeout: 15000,
      });
      this.applyFix(fix.lat, fix.lng, fix.accuracy, fix.bearing, true);
    } catch (e) {
      this.error = `Could not read GPS: ${(e as Error)?.message || 'permission denied'}`;
    }

    // Offline → we own the watch (purely to animate the marker). Online → the
    // presence service already streams + feeds onLocated, so we stay out of it.
    if (!this.isOnline) {
      await this.startVisualWatch();
    }
  }

  private async startVisualWatch(): Promise<void> {
    if (this.visualWatchId) return;
    this.visualWatchId = await this.geo.watchPosition(
      { enableHighAccuracy: true, maximumAge: 4000, timeout: 30000 },
      (fix, err) => {
        if (err || !fix) return;
        this.applyFix(fix.lat, fix.lng, fix.accuracy, fix.bearing);
      },
    );
  }

  private async stopVisualWatch(): Promise<void> {
    const id = this.visualWatchId;
    if (!id) return;
    this.visualWatchId = null;
    await this.geo.clearWatch(id);
  }

  /** Recenter FAB — re-arm follow mode and snap back to the driver. */
  async recenter(): Promise<void> {
    this.followMe = true;
    if (this.lastPos && this.map) {
      this.map.panTo(this.lastPos);
      if (this.map.getZoom() < 15) this.map.setZoom(16);
      return;
    }
    this.locating = true;
    try {
      const fix = await this.geo.getCurrentPosition({ enableHighAccuracy: true, timeout: 15000 });
      this.applyFix(fix.lat, fix.lng, fix.accuracy, fix.bearing, true);
    } catch (e) {
      this.error = `Could not read GPS: ${(e as Error)?.message || 'permission denied'}`;
    } finally {
      this.locating = false;
    }
  }

  /**
   * Single source of truth for "put the driver on the map". Builds the puck +
   * accuracy ring once, then only moves them on subsequent fixes.
   */
  private applyFix(
    lat: number,
    lng: number,
    accuracy: number | null,
    bearing: number | null,
    recenter = false,
  ): void {
    if (!this.map) return;
    this.hasFix = true;
    this.lastPos = { lat, lng };
    const pos = { lat, lng };

    if (!this.selfMarker) {
      this.selfMarker = new google.maps.marker.AdvancedMarkerElement({
        map: this.map,
        position: pos,
        title: 'You',
        content: this.buildSelfMarkerContent(),
      });
    } else {
      this.selfMarker.position = pos;
      if (this.selfMarker.map !== this.map) {
        this.selfMarker.map = this.map;
      }
    }

    // Rotate the heading wedge if we have a bearing.
    if (this.markerHeading) {
      if (bearing != null && Number.isFinite(bearing)) {
        this.markerHeading.style.opacity = '1';
        this.markerHeading.style.transform = `rotate(${bearing}deg)`;
      } else {
        this.markerHeading.style.opacity = '0';
      }
    }

    // GPS accuracy halo.
    if (accuracy != null && Number.isFinite(accuracy)) {
      if (!this.accuracyCircle) {
        this.accuracyCircle = new google.maps.Circle({
          map: this.map,
          center: pos,
          radius: accuracy,
          strokeColor: '#12B35B',
          strokeOpacity: 0.35,
          strokeWeight: 1,
          fillColor: '#12B35B',
          fillOpacity: 0.1,
          clickable: false,
        });
      } else {
        this.accuracyCircle.setCenter(pos);
        this.accuracyCircle.setRadius(accuracy);
      }
    }

    if (recenter || this.followMe) {
      this.map.panTo(pos);
      if (this.map.getZoom() < 15) this.map.setZoom(16);
    }
  }

  private buildSelfMarkerContent(): HTMLElement {
    // Styles for these classes live in global.scss — AdvancedMarkerElement
    // content is rendered outside this component's view encapsulation, so
    // component-scoped SCSS (and @keyframes) would not reach it.
    const wrap = document.createElement('div');
    wrap.className = 'driver-puck';

    const pulse = document.createElement('div');
    pulse.className = 'driver-puck__pulse';

    const heading = document.createElement('div');
    heading.className = 'driver-puck__heading';
    heading.style.opacity = '0';
    this.markerHeading = heading;

    const dot = document.createElement('div');
    dot.className = 'driver-puck__dot';

    wrap.appendChild(pulse);
    wrap.appendChild(heading);
    wrap.appendChild(dot);
    return wrap;
  }

  // ------------------------------------------------------------ online flip ---

  async goOnline(): Promise<void> {
    if (this.toggling) return;
    this.toggling = true;
    this.error = null;

    try {
      await this.geo.requestPermissions();

      await new Promise<void>((resolve, reject) => {
        this.api.post<{ driver: Record<string, unknown> }>('/drivers/go-online', {}).subscribe({
          next: (res) => { this.driver = res.driver; resolve(); },
          // Hand the raw HttpErrorResponse through so the catch can read the
          // structured low-wallet-balance payload, not just a message string.
          error: (err) => reject(err),
        });
      });

      // Hand GPS ownership to the presence service (it streams + feeds onLocated).
      await this.stopVisualWatch();
      await this.presence.start();
      this.startOnlineTimer();

      await this.waitForMap();
      if (this.map) {
        google.maps.event.trigger(this.map, 'resize');
      }
      this.followMe = true;
    } catch (e) {
      const body = (e as { error?: Record<string, unknown> })?.error;
      if (body?.['error_code'] === 'low_wallet_balance') {
        await this.presentLowWalletAlert(body);
      } else {
        this.error = (body?.['message'] as string) || (e as Error)?.message || 'Could not go online';
      }
    } finally {
      this.toggling = false;
    }
  }

  /**
   * The 422 go-online wallet gate: explain the shortfall and offer a one-tap
   * route to top up. Falls back to a generic line if the server omitted figures.
   */
  private async presentLowWalletAlert(body: Record<string, unknown>): Promise<void> {
    const required = Number(body['required_balance']);
    const current = Number(body['current_balance']);
    const message =
      (body['message'] as string) ||
      (Number.isFinite(required)
        ? `Your wallet (₹${Number.isFinite(current) ? current : this.walletBalance}) is below the ₹${required} needed to go online. Add funds to start driving.`
        : 'Your wallet balance is too low to go online. Add funds to start driving.');

    const alert = await this.alertCtrl.create({
      header: 'Top up to go online',
      message,
      buttons: [
        { text: 'Not now', role: 'cancel' },
        { text: 'Add funds', handler: () => { this.router.navigateByUrl('/tabs/wallet'); } },
      ],
    });
    await alert.present();
  }

  async goOffline(): Promise<void> {
    if (this.toggling) return;
    this.toggling = true;
    this.error = null;

    try {
      await new Promise<void>((resolve, reject) => {
        this.api.post<{ driver: Record<string, unknown> }>('/drivers/go-offline', {}).subscribe({
          next: (res) => { this.driver = res.driver; resolve(); },
          error: (err) => reject(new Error(err?.error?.message || 'Could not go offline')),
        });
      });
      await this.presence.stop();
      this.stopOnlineTimer();
      // Keep showing the driver where they are — take the watch back ourselves.
      await this.startVisualWatch();
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.toggling = false;
    }
  }

  // ----------------------------------------------------------- online timer ---

  private startOnlineTimer(): void {
    if (this.onlineTimer) return;
    if (!this.onlineSince) this.onlineSince = Date.now();
    this.tickElapsed();
    this.onlineTimer = setInterval(() => this.tickElapsed(), 1000);
  }

  private stopOnlineTimer(): void {
    if (this.onlineTimer) {
      clearInterval(this.onlineTimer);
      this.onlineTimer = null;
    }
    this.onlineSince = null;
    this.onlineElapsed = '00:00';
  }

  private tickElapsed(): void {
    if (!this.onlineSince) return;
    const secs = Math.max(0, Math.floor((Date.now() - this.onlineSince) / 1000));
    const pad = (n: number) => n.toString().padStart(2, '0');
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    this.onlineElapsed = h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }
}
