import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { AlertController, createAnimation, IonPopover, ViewDidEnter, ViewDidLeave, ViewWillEnter } from '@ionic/angular';
import { Subscription, interval } from 'rxjs';

import { ApiService } from '../../../core/api.service';
import { AuthService } from '../../../core/auth.service';
import {
  buildPassengerMarkerElement,
  buildReusableCarMarkerElement,
  updateCarMarkerBearing,
} from '../../../core/car-marker.helper';
import { GeolocationService } from '../../../core/geolocation.service';
import { PlacesService } from '../../../core/places.service';
import { RealtimeService, TripLocationPayload } from '../../../core/realtime.service';
import {
  BookingService,
  resolveCity,
  nearestCity,
  distanceKm,
  pointInPolygon,
  scopesOffered,
  tilesFor,
  RawScope
} from '../booking.service';
import { City, RideMode, ServiceTile, TripScope } from '../booking.models';
import { environment } from '../../../../environments/environment';

declare const google: any;

export interface AppBanner {
  id: number;
  title: string;
  image_url: string;
  url_link: string | null;
  target_app: 'customer' | 'driver' | 'both';
  position: 'full_screen' | 'half';
  is_active: boolean;
}

export interface ActiveFixedRide {
  id: number;
  route_name?: string | null;
  trip_id?: number | null;
  departure_status?: string | null;
  status: string;
  driver_name?: string | null;
  driver_phone?: string | null;
  vehicle_name?: string | null;
  vehicle_brand?: string | null;
  vehicle_model?: string | null;
  vehicle_color?: string | null;
  vehicle_reg_no?: string | null;
  board?: string | null;
  drop?: string | null;
  board_lat?: number | null;
  board_lng?: number | null;
  drop_lat?: number | null;
  drop_lng?: number | null;
  fare_amount?: number | null;
  boarding_code?: string | null;
  seats?: number;
  stops?: Array<{ id: number; seq: number; name: string; lat: number | null; lng: number | null }>;
  latest_driver_location?: { lat: number; lng: number; recorded_at?: string } | null;
}

interface HomeRoute {
  id: number;
  name: string;
  scope: TripScope;
  origin_name?: string;
  dest_name?: string;
  flat_fare?: number | null;
  stops?: Array<{ id: number }>;
}

interface HomeOffer {
  id: number;
  title: string;
  discount_label: string;
  subtitle?: string | null;
  description?: string | null;
  status: 'available' | 'used' | 'expired';
  is_available: boolean;
}

/**
 * Home — Google Maps behind the bottom sheet, live GPS tracking & Active Ride overlay.
 */
@Component({
  selector: 'app-booking-home',
  templateUrl: './booking-home.page.html',
  styleUrls: ['./booking-home.page.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BookingHomePage implements OnInit, ViewWillEnter, ViewDidEnter, ViewDidLeave, OnDestroy {
  @ViewChild('mapEl', { static: true }) mapElRef!: ElementRef<HTMLDivElement>;
  @ViewChild('tripsPopover') tripsPopover?: IonPopover;

  tripsOpen = false;
  private failedProfileImageUrl: string | null = null;

  get profileImageUrl(): string | null {
    const url = this.auth.resolveAvatarUrl(this.auth.getUser());
    return url && url !== this.failedProfileImageUrl ? url : null;
  }

  onProfileImageError(url: string): void {
    this.failedProfileImageUrl = url;
    this.cdr.markForCheck();
  }

  get motionEnabled(): boolean {
    return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  readonly tripsLeaveAnimation = (baseEl: HTMLElement) => {
    const root = baseEl.shadowRoot ?? baseEl;
    const panel = root.querySelector<HTMLElement>('[part="content"]');
    const arrow = root.querySelector<HTMLElement>('[part="arrow"]');
    const backdrop = root.querySelector<HTMLElement>('ion-backdrop');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const animation = createAnimation()
      .duration(reducedMotion ? 0 : 180)
      .easing('cubic-bezier(.4, 0, 1, 1)');
    if (panel) {
      animation.addAnimation(createAnimation().addElement(panel)
        .beforeStyles({ 'transform-origin': 'bottom center' })
        .fromTo('opacity', '1', '0')
        .fromTo('transform', 'translateY(0) scale(1)', reducedMotion ? 'none' : 'translateY(4px) scale(.99)')
        .afterClearStyles(['opacity', 'transform']));
    }
    if (arrow) animation.addAnimation(createAnimation().addElement(arrow).fromTo('opacity', '1', '0'));
    if (backdrop) animation.addAnimation(createAnimation().addElement(backdrop).fromTo('opacity', 'var(--backdrop-opacity)', '0'));
    // Preserve Ionic's positioning lifecycle for the next presentation.
    return animation.afterAddWrite(() => {
      baseEl.style.removeProperty('--width');
      baseEl.classList.remove('popover-bottom');
      for (const property of ['top', 'left', 'bottom', 'transform-origin']) panel?.style.removeProperty(property);
      for (const property of ['top', 'left', 'display']) arrow?.style.removeProperty(property);
    });
  };
  readonly tripSections = [
    { title: 'Fixed route bookings', description: 'Your seats on fixed routes', icon: 'bus-outline', path: '/customer-tabs/fixed-rides' },
    { title: 'Private rides', description: 'Your whole-car journeys', icon: 'car-outline', path: '/customer-tabs/my-trips' },
    { title: 'Shuttle bookings', description: 'Your shared shuttle rides', icon: 'git-merge-outline', path: '/customer-tabs/shuttle-rides' },
    { title: 'Scheduled rides', description: 'Trips planned for later', icon: 'calendar-outline', path: '/customer-tabs/scheduled-rides' },
  ];

  loading = true;
  locationFetching = true;
  locationPermissionNeeded = false;
  mapReady = false;

  scope: TripScope = 'local';
  scopes: TripScope[] = ['local'];
  mode: RideMode | null = null;
  tiles: ServiceTile[] = [];

  city: City | null = null;
  located = false;
  homeExpanded = false;
  savedPlaces: Array<{ label: string }> = [];
  homeOffers: HomeOffer[] = [];
  promotionTab: 'coupons' | 'offers' = 'offers';
  offerBanners: AppBanner[] = [];
  private dismissedHomeBanners = new Set<number>();
  private failedHomeBannerImages = new Set<string>();
  private homeOffersSub?: Subscription;
  homeRoutes: HomeRoute[] = [];
  routesLoading = false;
  routesError = false;
  private homeRoutesSub?: Subscription;

  // ── App Banners ─────────────────────────────────────────────────────────
  fullScreenBanner: AppBanner | null = null;
  halfBanner: AppBanner | null = null;
  isFullScreenDismissed = false;
  isHalfBannerCollapsed = false;

  // Active Live Fixed Ride
  activeFixedRide: ActiveFixedRide | null = null;
  private activeRidePollSub?: Subscription;
  private activeRideTrackingUnsub: (() => void) | null = null;
  private activeRideTrackingTripId: number | null = null;
  private fixedPickupMarker: any = null;
  private fixedDropMarker: any = null;
  private fixedDriverMarker: any = null;
  private fixedRoutePolylines: any[] = [];
  private driverPosition: { lat: number; lng: number } | null = null;
  private driverBearing = 0;

  private catalog: RawScope[] = [];

  // ── Google Maps internals ────────────────────────────────────────────────
  private map: any = null;
  private userMarker: any = null;   // AdvancedMarkerElement
  private accuracyCircle: any = null;
  private watchId: string | null = null;

  constructor(
    private alertCtrl: AlertController,
    private api: ApiService,
    private auth: AuthService,
    private booking: BookingService,
    private geo: GeolocationService,
    private places: PlacesService,
    private realtime: RealtimeService,
    private router: Router,
    private zone: NgZone,
    private cdr: ChangeDetectorRef,
  ) {}

  private bannerRealtimeUnsub: (() => void) | null = null;
  private bannerPollSub?: Subscription;

  async ngOnInit(): Promise<void> {
    this.setupBannerSubscription();
    this.loadBanners();
    await this.initHome();
  }

  ionViewWillEnter(): void {
    this.loadSavedPlaces();
    this.loadHomeOffers();
    if (!this.located || !this.city) {
      void this.initHome();
    }
    this.setupBannerSubscription();
    this.loadBanners();
    this.checkActiveFixedRide();
    this.activeRidePollSub ??= interval(6000).subscribe(() => this.checkActiveFixedRide());
  }

  ionViewDidEnter(): void {
    if (this.map && !this.watchId) {
      void this.startWatch();
    }
    if (this.map && this.activeFixedRide) {
      this.syncActiveRideMap();
    }
  }

  ionViewDidLeave(): void {
    if (this.watchId) {
      void this.geo.clearWatch(this.watchId);
      this.watchId = null;
    }
    this.activeRidePollSub?.unsubscribe();
    this.activeRidePollSub = undefined;
    this.stopActiveRideTracking();
    this.bannerPollSub?.unsubscribe();
    this.bannerPollSub = undefined;
  }

  ngOnDestroy(): void {
    this.homeOffersSub?.unsubscribe();
    this.homeRoutesSub?.unsubscribe();
    if (this.watchId) {
      void this.geo.clearWatch(this.watchId);
      this.watchId = null;
    }
    this.activeRidePollSub?.unsubscribe();
    this.activeRidePollSub = undefined;
    this.stopActiveRideTracking();
    this.clearActiveRideMap();
    this.bannerRealtimeUnsub?.();
    this.bannerRealtimeUnsub = null;
    this.bannerPollSub?.unsubscribe();
    this.bannerPollSub = undefined;
    this.userMarker = null;
    this.map = null;
  }

  // ── App Banners handlers ────────────────────────────────────────────────
  setupBannerSubscription(): void {
    if (!this.bannerRealtimeUnsub) {
      this.bannerRealtimeUnsub = this.realtime.subscribeAppBanners((payload) => {
        if (payload.target_app === 'both' || payload.target_app === 'customer') {
          this.zone.run(() => this.loadBanners(true));
        }
      });
    }

    this.bannerPollSub ??= interval(20000).subscribe(() => {
      this.loadBanners(false);
    });
  }

  loadBanners(isLiveEvent = false): void {
    this.api.get<{ data: AppBanner[] }>('/app-banners?app=customer').subscribe({
      next: (res) => {
        const banners = res?.data ?? [];
        const nextOffers = banners.filter(banner => banner.position === 'half');
        for (const banner of nextOffers) {
          const previous = this.offerBanners.find(item => item.id === banner.id);
          if (!previous || previous.title !== banner.title || previous.image_url !== banner.image_url || previous.url_link !== banner.url_link) {
            this.dismissedHomeBanners.delete(banner.id);
            this.failedHomeBannerImages.delete(`${banner.id}:${banner.image_url}`);
          }
        }
        this.offerBanners = nextOffers;
        const newFullScreen = banners.find((b) => b.position === 'full_screen') || null;
        const newHalf = banners.find((b) => b.position === 'half') || null;

        // If a full-screen banner was added or changed by admin, make it visible live!
        if (newFullScreen) {
          const changed = !this.fullScreenBanner ||
            this.fullScreenBanner.id !== newFullScreen.id ||
            this.fullScreenBanner.title !== newFullScreen.title ||
            this.fullScreenBanner.image_url !== newFullScreen.image_url;
          if (changed) {
            this.isFullScreenDismissed = false;
          }
        } else {
          this.isFullScreenDismissed = false;
        }

        // If a half banner was added or changed by admin, make it visible live!
        if (newHalf) {
          const changed = !this.halfBanner ||
            this.halfBanner.id !== newHalf.id ||
            this.halfBanner.title !== newHalf.title ||
            this.halfBanner.image_url !== newHalf.image_url;
          if (changed) {
            this.isHalfBannerCollapsed = false;
          }
        } else {
          this.isHalfBannerCollapsed = false;
        }

        this.fullScreenBanner = newFullScreen;
        this.halfBanner = newHalf;
        this.cdr.markForCheck();
      },
      error: () => {},
    });
  }

  dismissFullScreenBanner(): void {
    this.isFullScreenDismissed = true;
    this.cdr.markForCheck();
  }

  collapseHalfBanner(): void {
    this.isHalfBannerCollapsed = true;
    this.cdr.markForCheck();
  }

  expandHalfBanner(): void {
    this.isHalfBannerCollapsed = false;
    this.cdr.markForCheck();
  }

  get showOfferPill(): boolean {
    if (this.locationPermissionNeeded) return false;
    if (this.fullScreenBanner && !this.isFullScreenDismissed) return false;
    if (this.halfBanner && !this.isHalfBannerCollapsed) return false;
    return (
      (!!this.fullScreenBanner && this.isFullScreenDismissed) ||
      (!!this.halfBanner && this.isHalfBannerCollapsed)
    );
  }

  reopenOfferBanner(): void {
    this.promotionTab = 'offers';
    this.dismissedHomeBanners.clear();
    if (this.fullScreenBanner && this.isFullScreenDismissed) {
      this.isFullScreenDismissed = false;
    } else if (this.halfBanner && this.isHalfBannerCollapsed) {
      this.isHalfBannerCollapsed = false;
    } else {
      this.isFullScreenDismissed = false;
      this.isHalfBannerCollapsed = false;
    }
    this.cdr.markForCheck();
  }

  get visibleHomeBanners(): AppBanner[] {
    const banners = this.offerBanners.length ? this.offerBanners : (this.halfBanner ? [this.halfBanner] : []);
    return banners.filter(banner => !this.dismissedHomeBanners.has(banner.id)
      && !(banner.id === this.halfBanner?.id && this.isHalfBannerCollapsed));
  }

  trackHomeBanner = (_: number, banner: AppBanner): number => banner.id;

  homeBannerImage(banner: AppBanner): string {
    return this.failedHomeBannerImages.has(`${banner.id}:${banner.image_url}`) ? '' : this.resolveBannerImageUrl(banner.image_url);
  }

  onHomeBannerImageError(banner: AppBanner): void {
    this.failedHomeBannerImages.add(`${banner.id}:${banner.image_url}`);
    this.cdr.markForCheck();
  }

  dismissHomeBanner(banner: AppBanner): void {
    this.dismissedHomeBanners.add(banner.id);
    if (banner.id === this.halfBanner?.id) this.collapseHalfBanner();
    this.cdr.markForCheck();
  }

  resolveBannerImageUrl(url: string | null | undefined): string {
    const value = url?.trim();
    if (!value) return '';
    const apiBase = environment.apiUrl.replace(/\/api\/?$/i, '').replace(/\/$/, '');

    try {
      const apiOrigin = new URL(apiBase);
      const imageUrl = new URL(value, `${apiBase}/`);
      if (!['http:', 'https:'].includes(imageUrl.protocol)) return '';

      if (['localhost', '127.0.0.1', '[::1]'].includes(imageUrl.hostname)) {
        return `${apiBase}${imageUrl.pathname}${imageUrl.search}${imageUrl.hash}`;
      }

      // Older servers can return HTTP links for uploads on our HTTPS API host.
      if (apiOrigin.protocol === 'https:' && imageUrl.protocol === 'http:'
        && imageUrl.host === apiOrigin.host) {
        imageUrl.protocol = 'https:';
      }
      return imageUrl.href;
    } catch {
      return '';
    }
  }

  async onBannerClick(banner: AppBanner | null): Promise<void> {
    if (!banner?.url_link) return;
    const url = banner.url_link;
    const alert = await this.alertCtrl.create({
      header: 'Visit Link?',
      message: `Do you want to visit this link?\n\n${url}`,
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel',
        },
        {
          text: 'Visit Link',
          handler: () => {
            window.open(url, '_blank') || (window.location.href = url);
          },
        },
      ],
    });
    await alert.present();
  }

  private async initHome(): Promise<void> {
    this.locationFetching = true;
    this.locationPermissionNeeded = false;
    this.cdr.markForCheck();

    await Promise.all([this.loadLocationAndCatalog(), this.initMap()]);
  }

  async requestLocation(): Promise<void> {
    this.locationPermissionNeeded = false;
    this.locationFetching = true;
    this.cdr.markForCheck();

    try {
      await this.geo.requestPermissions();
    } catch {
      /* ignore */
    }

    await this.loadLocationAndCatalog();
    if (this.located && this.map) {
      await this.startWatch();
    }
  }

  // ── Map setup ────────────────────────────────────────────────────────────

  private async initMap(): Promise<void> {
    try {
      await this.places.ensureLoaded();

      const el = this.mapElRef.nativeElement;

      this.map = new google.maps.Map(el, {
        center: { lat: 34.2985, lng: 74.4712 }, // Centered on Jammu & Kashmir region
        zoom: 14,
        disableDefaultUI: true,
        mapId: 'DEMO_MAP_ID',         // needed for AdvancedMarkerElement
        gestureHandling: 'greedy',    // single-finger pan on mobile
        clickableIcons: false,
      });

      this.zone.run(() => {
        this.mapReady = true;
        this.cdr.markForCheck();
      });

      // Start watching GPS once map is ready
      await this.startWatch();
    } catch {
      // Maps unavailable (offline / key missing)
      this.locationFetching = false;
      this.cdr.markForCheck();
    }
  }

  currentCoords: { lat: number; lng: number } | null = null;
  private hasFittedActiveBounds = false;

  recenterMap(): void {
    if (!this.map) return;
    if (this.activeFixedRide) {
      this.fitActiveRideBounds(true);
    } else if (this.currentCoords) {
      this.centerUserOnMap(this.currentCoords);
      this.map.setZoom(16);
    } else {
      void this.requestLocation();
    }
  }

  private async startWatch(): Promise<void> {
    // Quick first fix — centre the map immediately if no active ride.
    try {
      const fix = await this.geo.getCurrentFix();
      if (fix) {
        this.updateMapPosition(fix.lat, fix.lng, fix.accuracy ?? 40, !this.activeFixedRide, fix.bearing);
      }
    } catch {
      /* ignore */
    }

    // Continuous watch — moves user avatar marker smoothly as user walks without jarring map pans.
    try {
      if (this.watchId) {
        await this.geo.clearWatch(this.watchId);
      }
      this.watchId = await this.geo.watchPosition(
        { enableHighAccuracy: true, maximumAge: 2000 },
        (pos, err) => {
          if (err || !pos) return;
          this.updateMapPosition(pos.lat, pos.lng, pos.accuracy ?? 40, false, pos.bearing);
        },
      );
    } catch {
      /* ignore */
    }
  }

  private async updateMapPosition(
    lat: number, lng: number, accuracy: number, pan: boolean, bearing?: number | null,
  ): Promise<void> {
    if (!this.map) return;
    const latlng = { lat, lng };
    this.currentCoords = latlng;
    this.located = true;

    if (!this.userMarker) {
      const { AdvancedMarkerElement } = await (google.maps as any).importLibrary('marker');

      this.userMarker = new AdvancedMarkerElement({
        map: this.map,
        position: latlng,
        content: buildPassengerMarkerElement({
          kind: 'pickup',
          name: this.auth.getUser()?.name || 'You',
          isLive: true,
          avatarUrl: this.auth.resolveAvatarUrl(this.auth.getUser()),
        }),
        zIndex: 1100,
        title: 'Your exact location',
      });
    } else {
      this.userMarker.position = latlng;
      if (!this.userMarker.map) this.userMarker.map = this.map;
    }

    if (pan) {
      this.centerUserOnMap(latlng);
      this.map.setZoom(16);
    }
  }

  private centerUserOnMap(coords: { lat: number; lng: number }): void {
    this.map.setCenter(coords);
    // Keep the location pin in the visible map above the mobile booking panel.
    if (window.innerWidth < 768) {
      this.map.panBy(0, Math.round(this.mapElRef.nativeElement.clientHeight * 0.22));
    }
  }

  // ── City / catalogue loading ─────────────────────────────────────────────

  private async loadLocationAndCatalog(): Promise<void> {
    this.zone.run(() => {
      this.loading = true;
      this.cdr.markForCheck();
    });

    try {
      const cities = await this.booking.cities().catch(() => [] as City[]);

      // Attempt to retrieve real coordinates from device GPS
      let fix = await this.geo.getCurrentPosition();
      if (!fix) {
        const longFix = await this.geo.getCurrentFix();
        if (longFix) fix = { lat: longFix.lat, lng: longFix.lng };
      }

      const hasGpsFix = !!fix;
      if (!fix) {
        // Fall back gracefully to the first city or default center without blocking the user with a modal
        const defaultCity = cities[0] || {
          id: 1,
          name: 'Sopore',
          center_lat: 34.2985,
          center_lng: 74.4712,
        };
        fix = {
          lat: Number(defaultCity.center_lat ?? 34.2985),
          lng: Number(defaultCity.center_lng ?? 74.4712),
        };
      }

      // 1. Check if user coordinates match an active Admin City's boundary polygon
      let adminCity = cities.find((c) =>
        Array.isArray(c.boundary_polygon) &&
        c.boundary_polygon.length >= 3 &&
        pointInPolygon(fix.lat, fix.lng, c.boundary_polygon)
      );

      // If no polygon match, check if user is within close proximity (<= 8km) of an Admin City center
      if (!adminCity && cities.length > 0) {
        for (const c of cities) {
          if (c.center_lat != null && c.center_lng != null) {
            const km = distanceKm(fix.lat, fix.lng, Number(c.center_lat), Number(c.center_lng));
            if (km <= 8) {
              adminCity = c;
              break;
            }
          }
        }
      }

      let activeCity: City;

      if (adminCity) {
        // Admin city exists for this location -> Use the Admin city entity
        activeCity = adminCity;
      } else {
        // City does not exist in Admin -> Detect real city / town name from device coordinates
        const detectedName = await this.places.reverseGeocodeCity(fix.lat, fix.lng).catch(() => null);
        const nearest = nearestCity(cities, fix.lat, fix.lng);
        const fallbackId = nearest?.id ?? cities[0]?.id ?? 1;

        activeCity = {
          id: fallbackId,
          name: detectedName || 'Your Location',
          center_lat: fix.lat,
          center_lng: fix.lng,
        };
      }

      const catalogData = activeCity.id
        ? await this.booking.catalog(activeCity.id).catch(() => [])
        : [];

      this.zone.run(() => {
        this.located = hasGpsFix || !!this.currentCoords;
        this.city = activeCity;
        this.locationPermissionNeeded = false;
        this.booking.setCity(activeCity.id);
        this.catalog = catalogData;

        const offered = scopesOffered(this.catalog);
        this.scopes = offered.length ? offered : ['local'];
        this.scope = this.scopes[0];
        this.rebuildTiles();
        this.loadHomeRoutes();
        this.locationFetching = false;
        this.loading = false;
        this.cdr.markForCheck();
      });

      // Pan map to user fix
      if (this.map) {
        if (hasGpsFix) {
          await this.updateMapPosition(fix.lat, fix.lng, 40, true);
        } else if (!this.currentCoords) {
          this.map.setCenter(fix);
          this.map.setZoom(12);
        }
      }
    } catch {
      this.zone.run(() => {
        const fallbackCity = {
          id: 1,
          name: 'Sopore',
          center_lat: 34.2985,
          center_lng: 74.4712,
        };
        this.located = !!this.currentCoords;
        this.city = fallbackCity as City;
        this.locationPermissionNeeded = false;
        this.locationFetching = false;
        this.loading = false;
        this.cdr.markForCheck();
      });
    }
  }

  // ── UI helpers ───────────────────────────────────────────────────────────

  get hasScopeSwitch(): boolean {
    return this.scopes.length > 1;
  }

  scopeLabel(scope: TripScope): string {
    return scope === 'outstation' ? 'Outstation' : 'Local';
  }

  pickScope(scope: TripScope): void {
    if (this.scope === scope) return;
    this.scope = scope;
    this.booking.setScope(scope);
    this.mode = null;
    this.rebuildTiles();
    this.loadHomeRoutes();
    this.cdr.markForCheck();
  }

  pickMode(tile: ServiceTile): void {
    this.mode = tile.mode;
    this.booking.setMode(tile.mode, tile.rideTypeId);
    this.cdr.markForCheck();
  }

  whereTo(): void {
    this.booking.setScope(this.scope);
    if (this.mode) this.booking.setMode(this.mode);

    switch (this.mode) {
      case 'private': void this.router.navigate(['/customer-tabs/go/private']); break;
      case 'fixed':   void this.router.navigate(['/customer-tabs/go/fixed']);   break;
      case 'shuttle': void this.router.navigate(['/customer-tabs/go/shuttle']); break;
      default:        void this.router.navigate(['/customer-tabs/go/private']);
    }
  }

  trackByMode = (_: number, tile: ServiceTile): string => tile.mode;

  private rebuildTiles(): void {
    this.tiles = tilesFor(this.catalog, this.scope);
    if (this.tiles.length && !this.tiles.some((t) => t.mode === this.mode)) {
      const first = this.tiles[0];
      this.mode = first.mode;
      this.booking.setMode(first.mode, first.rideTypeId);
    }
  }

  get offersFixed(): boolean {
    return this.tiles.some(tile => tile.mode === 'fixed');
  }

  private loadSavedPlaces(): void {
    this.booking.savedPlaces().then(res => {
      this.savedPlaces = (res.data ?? [])
        .filter(place => typeof place.label === 'string' && place.label.trim())
        .slice(0, 4);
      this.cdr.markForCheck();
    }).catch(() => {
      this.savedPlaces = [];
      this.cdr.markForCheck();
    });
  }

  private loadHomeOffers(): void {
    this.homeOffersSub?.unsubscribe();
    this.homeOffersSub = this.api.get<{ data: HomeOffer[] }>('/me/coupons').subscribe({
      next: res => {
        this.homeOffers = (res.data ?? []).filter(offer => offer.is_available && offer.status === 'available').slice(0, 5);
        this.cdr.markForCheck();
      },
      error: () => {
        this.homeOffers = [];
        this.cdr.markForCheck();
      },
    });
  }

  private loadHomeRoutes(): void {
    this.homeRoutesSub?.unsubscribe();
    this.homeRoutes = [];
    this.routesError = false;
    this.routesLoading = false;
    if (!this.city || !this.offersFixed) return;
    const params = new URLSearchParams({ city_id: String(this.city.id) });
    if (this.currentCoords) {
      params.set('lat', String(this.currentCoords.lat));
      params.set('lng', String(this.currentCoords.lng));
    }
    this.routesLoading = true;
    this.homeRoutesSub = this.api.get<{ data: HomeRoute[] }>('/fixed/routes?' + params).subscribe({
      next: res => {
        this.homeRoutes = (res.data ?? []).filter(route => route.scope === this.scope).slice(0, 3);
        this.routesLoading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.routesLoading = false;
        this.routesError = true;
        this.cdr.markForCheck();
      },
    });
  }

  openHomeRoute(route: HomeRoute): void {
    const fixed = this.tiles.find(tile => tile.mode === 'fixed');
    if (!fixed) return;
    this.pickMode(fixed);
    this.booking.setScope(this.scope);
    void this.router.navigate(['/customer-tabs/go/fixed'], { queryParams: { routeId: route.id } });
  }

  browseFixedRoutes(): void {
    const fixed = this.tiles.find(tile => tile.mode === 'fixed');
    if (!fixed) return;
    this.pickMode(fixed);
    this.whereTo();
  }

  async openVoice(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'DreamCabs AI',
      message: 'Voice booking is coming soon. For now, use “Where to?” to book your ride.',
      buttons: [{ text: 'Got it', role: 'cancel' }],
    });
    await alert.present();
  }

  async navigateToTripList(path: string): Promise<void> {
    await this.tripsPopover?.dismiss();
    void this.router.navigateByUrl(path);
  }

  // ── Active Live Fixed Ride Tracking & Map ────────────────────────────────
  checkActiveFixedRide(): void {
    this.api.get<{ data: ActiveFixedRide[] }>('/fixed/bookings?per_page=5').subscribe({
      next: (res) => {
        const list = res?.data || [];
        const active = list.find((b) =>
          ['BOOKED', 'CONFIRMED', 'BOARDED'].includes((b.status || '').toUpperCase()) &&
          !['DROPPED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'].includes((b.status || '').toUpperCase())
        );

        if (active) {
          this.api.get<{ booking: ActiveFixedRide }>('/fixed/bookings/' + active.id).subscribe({
            next: (bRes) => {
              const full = bRes?.booking || active;
              this.activeFixedRide = full;
              if (full.latest_driver_location?.lat != null && full.latest_driver_location?.lng != null) {
                this.driverPosition = {
                  lat: Number(full.latest_driver_location.lat),
                  lng: Number(full.latest_driver_location.lng),
                };
              }
              if (this.map) {
                this.syncActiveRideMap();
              }
              this.syncActiveRideTracking();
              this.cdr.markForCheck();
            },
            error: () => {
              this.activeFixedRide = active;
              if (this.map) {
                this.syncActiveRideMap();
              }
              this.syncActiveRideTracking();
              this.cdr.markForCheck();
            },
          });
        } else {
          if (this.activeFixedRide) {
            this.activeFixedRide = null;
            this.driverPosition = null;
            this.hasFittedActiveBounds = false;
            this.clearActiveRideMap();
            this.stopActiveRideTracking();
            this.cdr.markForCheck();
          }
        }
      },
      error: () => {},
    });
  }

  private syncActiveRideMap(): void {
    if (!this.map || typeof google === 'undefined' || !this.activeFixedRide) return;
    const b = this.activeFixedRide;

    // 1. Pickup Pin Marker
    if (b.board_lat != null && b.board_lng != null) {
      const pos = { lat: Number(b.board_lat), lng: Number(b.board_lng) };
      const label = 'Pickup: ' + (b.board || 'Stop');
      if (!this.fixedPickupMarker) {
        this.fixedPickupMarker = new google.maps.marker.AdvancedMarkerElement({
          position: pos,
          map: this.map,
          title: label,
          content: this.buildDashboardPin('pickup', label),
          zIndex: 900,
        });
      } else {
        this.fixedPickupMarker.position = pos;
        if (!this.fixedPickupMarker.map) this.fixedPickupMarker.map = this.map;
      }
    }

    // 2. Drop Pin Marker
    if (b.drop_lat != null && b.drop_lng != null) {
      const pos = { lat: Number(b.drop_lat), lng: Number(b.drop_lng) };
      const label = 'Drop: ' + (b.drop || 'Stop');
      if (!this.fixedDropMarker) {
        this.fixedDropMarker = new google.maps.marker.AdvancedMarkerElement({
          position: pos,
          map: this.map,
          title: label,
          content: this.buildDashboardPin('drop', label),
          zIndex: 900,
        });
      } else {
        this.fixedDropMarker.position = pos;
        if (!this.fixedDropMarker.map) this.fixedDropMarker.map = this.map;
      }
    }

    // 3. Driver Vehicle Live Marker (Only when real driver GPS position exists)
    if (this.driverPosition) {
      const driverLabel = b.driver_name || b.vehicle_name || 'Driver';
      if (!this.fixedDriverMarker) {
        this.fixedDriverMarker = new google.maps.marker.AdvancedMarkerElement({
          position: this.driverPosition,
          map: this.map,
          title: driverLabel,
          content: buildReusableCarMarkerElement({
            bearing: this.driverBearing,
            label: driverLabel,
          }),
          zIndex: 1000,
        });
      } else {
        this.fixedDriverMarker.position = this.driverPosition;
        if (!this.fixedDriverMarker.map) this.fixedDriverMarker.map = this.map;
        updateCarMarkerBearing(this.fixedDriverMarker, this.driverBearing);
      }
    } else if (this.fixedDriverMarker) {
      this.fixedDriverMarker.map = null;
      this.fixedDriverMarker = null;
    }

    // 4. Draw Route Polyline
    this.renderActiveRidePolyline();

    // 5. Fit Map Bounds (Only once on initial load, prevents screen jumping)
    this.fitActiveRideBounds(false);
  }

  private renderActiveRidePolyline(): void {
    if (!this.map || typeof google === 'undefined') return;

    for (const poly of this.fixedRoutePolylines) {
      poly.setMap(null);
    }
    this.fixedRoutePolylines = [];
    // Route polylines eliminated: customer sees only pickup/drop pins and driver live vehicle marker
  }

  private fitActiveRideBounds(force = false): void {
    if (!this.map || typeof google === 'undefined' || !this.activeFixedRide) return;
    if (this.hasFittedActiveBounds && !force) return;

    try {
      const bounds = new google.maps.LatLngBounds();
      let count = 0;
      if (this.currentCoords) {
        bounds.extend(this.currentCoords);
        count++;
      }
      if (this.driverPosition) {
        bounds.extend(this.driverPosition);
        count++;
      }
      if (this.activeFixedRide.board_lat != null && this.activeFixedRide.board_lng != null) {
        bounds.extend({ lat: Number(this.activeFixedRide.board_lat), lng: Number(this.activeFixedRide.board_lng) });
        count++;
      }
      if (this.activeFixedRide.drop_lat != null && this.activeFixedRide.drop_lng != null) {
        bounds.extend({ lat: Number(this.activeFixedRide.drop_lat), lng: Number(this.activeFixedRide.drop_lng) });
        count++;
      }

      if (count >= 2) {
        this.map.fitBounds(bounds, { top: 80, bottom: 280, left: 40, right: 40 });
        this.hasFittedActiveBounds = true;
      }
    } catch {
      /* ignore */
    }
  }

  private syncActiveRideTracking(): void {
    const tripId = this.activeFixedRide?.trip_id;
    if (!tripId) {
      this.stopActiveRideTracking();
      return;
    }
    if (this.activeRideTrackingTripId === tripId && this.activeRideTrackingUnsub) return;

    this.stopActiveRideTracking();
    this.activeRideTrackingTripId = tripId;
    this.activeRideTrackingUnsub = this.realtime.subscribeTracking(
      tripId,
      (payload: TripLocationPayload) => {
        if (payload?.location) {
          const loc = payload.location;
          this.zone.run(() => {
            this.driverPosition = { lat: loc.lat, lng: loc.lng };
            if (loc.bearing_deg != null) this.driverBearing = loc.bearing_deg;
            this.syncActiveRideMap();
            this.cdr.markForCheck();
          });
        }
      },
      () => {
        this.zone.run(() => this.checkActiveFixedRide());
      },
    );
  }

  private stopActiveRideTracking(): void {
    if (this.activeRideTrackingUnsub) {
      this.activeRideTrackingUnsub();
      this.activeRideTrackingUnsub = null;
    }
    this.activeRideTrackingTripId = null;
  }

  private clearActiveRideMap(): void {
    if (this.fixedPickupMarker) {
      this.fixedPickupMarker.map = null;
      this.fixedPickupMarker = null;
    }
    if (this.fixedDropMarker) {
      this.fixedDropMarker.map = null;
      this.fixedDropMarker = null;
    }
    if (this.fixedDriverMarker) {
      this.fixedDriverMarker.map = null;
      this.fixedDriverMarker = null;
    }
    for (const poly of this.fixedRoutePolylines) {
      poly.setMap(null);
    }
    this.fixedRoutePolylines = [];
  }

  private buildDashboardPin(kind: 'pickup' | 'drop', label: string): HTMLElement {
    const el = document.createElement('div');
    el.className = `dc-dash-pin dc-dash-pin--${kind}`;
    const bg = kind === 'pickup' ? '#10B981' : '#0F172A';
    el.innerHTML = `
      <div style="background: ${bg}; color: #ffffff; font-size: 10.5px; font-weight: 850; padding: 2.5px 8px; border-radius: 99px; box-shadow: 0 3px 8px rgba(15, 23, 42, 0.3); border: 1.5px solid #ffffff; white-space: nowrap; display: flex; align-items: center; gap: 4px;">
        <span>${label}</span>
      </div>
    `;
    return el;
  }

  openActiveFixedRide(): void {
    if (this.activeFixedRide?.id) {
      void this.router.navigate(['/customer-tabs/fixed-rides', this.activeFixedRide.id]);
    }
  }

  callDriver(phone?: string | null, event?: Event): void {
    event?.stopPropagation();
    if (phone) {
      window.open('tel:' + phone, '_system');
    }
  }

  activeRideStatusLabel(r: ActiveFixedRide): string {
    const status = (r.status || '').toUpperCase();
    const depStatus = (r.departure_status || '').toUpperCase();
    if (status === 'BOARDED') return 'Onboard · En Route';
    if (depStatus === 'IN_PROGRESS' || depStatus === 'STARTED') return 'Driver on route';
    if (depStatus === 'CLOSED') return 'Departure ready';
    return 'Booking confirmed';
  }
}

