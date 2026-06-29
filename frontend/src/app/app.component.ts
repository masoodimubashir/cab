import { Component, OnInit, ViewChild, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterOutlet, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { AuthService } from './core/auth.service';
import { ShellComponent, TopbarComponent, CitySwitcherComponent, NavSection, NavItem } from './layout';
import { ToastComponent } from './ui';

/**
 * App shell. Builds the sidebar nav config from the user's permissions and
 * delegates rendering to <tm-shell> + <tm-topbar>. Auth-free routes (signin)
 * bypass the shell.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, ShellComponent, TopbarComponent, CitySwitcherComponent, ToastComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit {
  @ViewChild(ShellComponent) shell?: ShellComponent;

  // Route → page title mapping. Keep in sync with app.routes.ts.
  private static readonly TITLES: Array<[RegExp, string]> = [
    [/^\/dashboard/,                'Dashboard'],
    [/^\/maps/,                     'Maps'],
    [/^\/customers\/[^/]+$/,        'Customer Details'],
    [/^\/customers/,                'Customers'],
    [/^\/drivers\/active/,          'Active Drivers'],
    [/^\/drivers\/deactivated/,     'Deactivated Drivers'],
    [/^\/drivers\/leaderboard/,     'Driver Leaderboard'],
    [/^\/drivers\/performance/,     'Driver Performance'],
    [/^\/drivers\/approvals\/[^/]+/,'Approval Details'],
    [/^\/drivers\/approvals/,       'Driver Approvals'],
    [/^\/drivers\/documents/,       'Document Catalog'],
    [/^\/contact-drivers/,          'Contact Drivers'],
    [/^\/pricing/,                  'Pricing'],
    [/^\/vehicle-fares/,            'Vehicle Setup'],
    [/^\/vehicle-setup-new/,        'Vehicle Setup'],
    [/^\/fare-settings/,            'Fare Settings'],
    [/^\/vehicles/,                 'Vehicles'],
    [/^\/promotions\/coupons/,      'Coupons'],
    [/^\/subscriptions/,            'Subscriptions'],
    [/^\/fixed-departures/,         'Live Fixed Vehicles'],
    [/^\/rides\/all/,               'All Rides'],
    [/^\/rides\/map/,               'Rides Map'],
    [/^\/rides\/manual-dispatch/,   'Manual Dispatch'],
    [/^\/notifications/,            'Notifications'],
    [/^\/settings\/operator/,       'Operator Settings'],
    [/^\/settings\/city/,           'City Settings'],
    [/^\/settings\/fleets/,         'Fleets'],
    [/^\/settings\/vehicle-types/,  'Vehicle Type'],
    [/^\/managers/,                 'Managers'],
    [/^\/roles-permissions/,        'Roles & Permissions'],
    [/^\/analytics\/real-time/,     'Real Time Analytics'],
    [/^\/analytics\/graphs/,        'Analytics Graphs'],
    [/^\/analytics\/reports/,       'Reports'],
    [/^\/safety/,                   'Safety'],
    [/^\/reports/,                  'Reports'],
  ];

  /**
   * Routes whose page actually re-scopes to the city chosen in the topbar
   * switcher (they observe CityContextService). The switcher is hidden
   * everywhere else — Vehicles/Ride types, RBAC, Managers, Maps, Operator
   * Settings, etc. are global or carry their own
   * city picker, so showing the global switcher there wrongly implies the
   * page's data is per-city. Keep in sync with app.routes.ts.
   */
  private static readonly CITY_SCOPED: RegExp[] = [
    /^\/city\b/,
    /^\/pricing\b/,
    /^\/vehicle-fares\b/,
    /^\/vehicle-setup-new\b/,
    /^\/fare-settings\b/,
    /^\/promotions\/coupons\b/,
    /^\/subscriptions\b/,
    /^\/fixed-routes\b/,
    /^\/fixed-departures\b/,
    /^\/settings\/(city|fleets|vehicle-types)\b/,
  ];

  private url = signal(this.router.url);
  /** Bumped whenever the auth profile is (re)loaded so pageTitle recomputes. */
  private profileTick = signal(0);

  pageTitle = computed(() => {
    // Topbar now greets the user. url()/profileTick() are read for reactivity.
    void this.url();
    void this.profileTick();
    const name = this.auth.profile?.name?.trim() || '';
    const first = name.split(/\s+/)[0];
    return first ? `Welcome, ${first}` : 'Welcome';
  });

  /** True only on pages that genuinely re-scope to the switched city. */
  showCitySwitcher = computed(() =>
    AppComponent.CITY_SCOPED.some((re) => re.test(this.url())),
  );

  constructor(public router: Router, public auth: AuthService) {}

  ngOnInit(): void {
    if (this.isAuthorized) {
      this.auth.ensureLoaded().subscribe(() =>
        this.profileTick.update((n) => n + 1),
      );
    }
    this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe((e) => {
        this.url.set((e as NavigationEnd).urlAfterRedirects);
        if (this.isAuthorized && !this.auth.profile) {
          this.auth.ensureLoaded().subscribe(() =>
            this.profileTick.update((n) => n + 1),
          );
        }
      });
  }

  /** Sidebar nav, filtered by the manager's permissions. */
  get navSections(): NavSection[] {
    const can = (slug: string) => this.auth.hasPermission(slug);
    const canAny = (slugs: string[]) => this.auth.hasAnyPermission(slugs);
    const filterTruthy = (xs: (NavItem | false | 0 | null | undefined)[]): NavItem[] =>
      xs.filter((x): x is NavItem => !!x);

    // Sidebar groups follow the city onboarding workflow:
    //   Home        → Dashboard, pinned above everything else
    //   City Setup  → configure a city (dependency-ordered)
    //   Operations  → run the city day-to-day
    //   Insights    → analytics & reports
    //   Platform    → global, not city-scoped
    const home: NavItem[] = [];
    const citySetup: NavItem[] = [];
    const operations: NavItem[] = [];
    const insights: NavItem[] = [];
    const platform: NavItem[] = [];

    // --- Home (top of nav, no section header) ---
    if (can('dashboard.view')) home.push({ label: 'Dashboard', icon: 'home', route: '/dashboard' });

    // --- City Setup (dependency order) ---
    citySetup.push({ label: 'City Workspace', icon: 'map-marker', route: '/city' });
    if (can('vehicles.view'))          citySetup.push({ label: 'Vehicles',      icon: 'car', route: '/vehicles' });
    if (canAny(['pricing.view','dynamic_pricing.manage']))
                                       citySetup.push({ label: 'Pricing',       icon: 'tag', route: '/pricing' });
    if (can('settings.manage'))        citySetup.push({ label: 'Vehicle Setup New', icon: 'car', route: '/vehicle-setup-new' });
    if (can('settings.manage'))        citySetup.push({ label: 'Vehicle Setup', icon: 'car', route: '/vehicle-fares' });
    if (can('settings.manage'))        citySetup.push({ label: 'Fare Settings',  icon: 'rupee', route: '/fare-settings' });
    if (can('routes.manage'))          citySetup.push({ label: 'Fixed Routes',  icon: 'road', route: '/fixed-routes' });
    if (can('settings.manage'))        citySetup.push({ label: 'City Settings', icon: 'cog', route: '/settings/city' });

    if (can('coupons.manage')) citySetup.push({ label: 'Coupons', icon: 'gift', route: '/promotions/coupons' });

    if (canAny(['subscriptions.manage', 'settings.manage']))
                                       citySetup.push({ label: 'Subscriptions', icon: 'star', route: '/subscriptions' });

    if (can('fleets.manage')) citySetup.push({ label: 'Fleets', icon: 'car', route: '/settings/fleets' });

    // --- Operations ---
    if (can('trips.view')) operations.push({ label: 'Rides', icon: 'road', route: '/rides' });

    if (can('reservations.view')) operations.push({ label: 'Live Fixed Vehicles', icon: 'calendar', route: '/fixed-departures' });

    if (can('rides.dispatch')) operations.push({ label: 'Manual Dispatch', icon: 'send', route: '/rides/manual-dispatch' });

    operations.push({ label: 'Notifications', icon: 'bell', route: '/notifications' });

    if (canAny(['drivers.view', 'drivers.edit', 'drivers.approve', 'documents.manage'])) {
      operations.push({
        label: 'Drivers', icon: 'id-card',
        children: filterTruthy([
          can('drivers.view')     && { label: 'All Drivers',           icon: 'user',  route: '/drivers' },
          can('drivers.approve')  && { label: 'Approvals & Documents',  icon: 'check', route: '/drivers', queryParams: { tab: 'approvals' } },
          can('documents.manage') && { label: 'Documents Catalog',      icon: 'edit',  route: '/drivers', queryParams: { tab: 'documents' } },
        ]),
      });
    }

    if (can('contact_drivers.send')) operations.push({ label: 'Contact Drivers', icon: 'envelope',   route: '/contact-drivers' });
    if (can('customers.view'))       operations.push({ label: 'Customers',       icon: 'user-plus',  route: '/customers' });
    if (can('maps.view'))            operations.push({ label: 'Maps',            icon: 'map',        route: '/maps' });
    if (can('safety.view'))          operations.push({ label: 'Safety',          icon: 'shield',     route: '/safety' });

    // --- Insights ---
    if (canAny(['analytics.view','reports.view'])) {
      insights.push({
        label: 'Analytics', icon: 'chart-bar',
        children: filterTruthy([
          can('analytics.view') && { label: 'Real Time', icon: 'chart-line', route: '/analytics/real-time' },
          can('analytics.view') && { label: 'Graphs',    icon: 'chart-bar',  route: '/analytics/graphs' },
          can('reports.view')   && { label: 'Reports',   icon: 'chart-line', route: '/analytics/reports' },
        ]),
      });
    }
    if (can('reports.view')) insights.push({ label: 'Reports', icon: 'chart-line', route: '/reports' });

    // --- Platform (global, not city-scoped) ---
    if (can('settings.manage')) platform.push({ label: 'Operator Settings',  icon: 'cog',    route: '/settings/operator' });
    if (can('managers.manage')) platform.push({ label: 'Managers',           icon: 'users',  route: '/managers' });
    if (can('roles.manage'))    platform.push({ label: 'Roles & Permissions', icon: 'shield', route: '/roles-permissions' });

    return [
      { items: home },                            // unlabeled — sits at the very top
      { label: 'City Setup', items: citySetup },
      { label: 'Operations', items: operations },
      { label: 'Insights',   items: insights },
      { label: 'Platform',   items: platform },
    ].filter((s) => s.items.length > 0);
  }

  /** Topbar user card — name + initials from auth profile. */
  get topbarUser(): { name: string; role?: string; initials: string } | undefined {
    const p = this.auth.profile;
    if (!p) return undefined;
    return {
      name: p.name,
      role: p.manager_role?.name,
      initials: this.initials(p.name),
    };
  }

  private initials(name: string): string {
    return name
      .split(/\s+/)
      .map((part) => part[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase();
  }

  logout(): void {
    localStorage.removeItem('dreamcabs_token');
    localStorage.removeItem('dreamcabs_api_base');
    this.auth.clear();
    this.router.navigateByUrl('/signin');
  }

  goProfile(): void {
    this.router.navigateByUrl('/profile');
  }

  openMobileNav(): void {
    this.shell?.openMobile();
  }

  get isAuthorized(): boolean {
    return !!localStorage.getItem('dreamcabs_token');
  }

  get isSigninRoute(): boolean {
    return this.router.url.startsWith('/signin');
  }

  get showShell(): boolean {
    return this.isAuthorized && !this.isSigninRoute;
  }

  get scopedCityName(): string | null {
    const p = this.auth.profile;
    if (!p || p.is_super_admin) return null;
    return p.manager_city_name;
  }
}
