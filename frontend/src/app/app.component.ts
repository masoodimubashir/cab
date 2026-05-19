import { Component, OnInit, ViewChild, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterOutlet, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { AuthService } from './core/auth.service';
import { ShellComponent, TopbarComponent, NavSection, NavItem } from './layout';
import { ToastComponent } from './ui';

/**
 * App shell. Builds the sidebar nav config from the user's permissions and
 * delegates rendering to <tm-shell> + <tm-topbar>. Auth-free routes (signin)
 * bypass the shell.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, ShellComponent, TopbarComponent, ToastComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit {
  @ViewChild(ShellComponent) shell?: ShellComponent;

  // Route → page title mapping. Keep in sync with app.routes.ts.
  private static readonly TITLES: Array<[RegExp, string]> = [
    [/^\/dashboard/,                'Dashboard'],
    [/^\/maps/,                     'Maps'],
    [/^\/users/,                    'Users'],
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
    [/^\/pricing/,                  'Base Pricing'],
    [/^\/dynamic-pricing/,          'Dynamic Pricing'],
    [/^\/vehicles/,                 'Vehicles'],
    [/^\/promotions\/city-wide/,    'City Wide Promotions'],
    [/^\/promotions\/promo-codes/,  'Promo Codes'],
    [/^\/promotions\/coupons/,      'Coupons'],
    [/^\/promotions\/referrals/,    'Referrals'],
    [/^\/rides\/all/,               'All Rides'],
    [/^\/rides\/map/,               'Rides Map'],
    [/^\/rides\/manual-dispatch/,   'Manual Dispatch'],
    [/^\/settings\/operator/,       'Operator Settings'],
    [/^\/settings\/city/,           'City Settings'],
    [/^\/settings\/geofencing/,     'Geofencing'],
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

    const items: NavItem[] = [];

    if (can('dashboard.view'))  items.push({ label: 'Dashboard', icon: 'home',      route: '/dashboard' });
    if (can('maps.view'))       items.push({ label: 'Maps',      icon: 'map',       route: '/maps' });
    if (can('users.view'))      items.push({ label: 'Users',     icon: 'users',     route: '/users' });
    if (can('customers.view'))  items.push({ label: 'Customers', icon: 'user-plus', route: '/customers' });

    if (canAny(['drivers.view', 'drivers.edit', 'drivers.approve', 'documents.manage'])) {
      items.push({
        label: 'Drivers', icon: 'id-card',
        children: filterTruthy([
          can('drivers.view')     && { label: 'All Drivers',          icon: 'user',  route: '/drivers' },
          can('drivers.approve')  && { label: 'Approvals & Documents', icon: 'check', route: '/drivers', queryParams: { tab: 'approvals' } },
          can('documents.manage') && { label: 'Documents Catalog',     icon: 'edit',  route: '/drivers', queryParams: { tab: 'documents' } },
        ]),
      });
    }

    if (can('pricing.view'))           items.push({ label: 'Base Pricing',    icon: 'tag',      route: '/pricing' });
    if (can('dynamic_pricing.manage')) items.push({ label: 'Dynamic Pricing', icon: 'bolt',     route: '/dynamic-pricing' });
    if (can('contact_drivers.send'))   items.push({ label: 'Contact Drivers', icon: 'envelope', route: '/contact-drivers' });
    if (can('vehicles.view'))          items.push({ label: 'Vehicles',        icon: 'car',      route: '/vehicles' });

    if (canAny(['promotions.manage','promo_codes.manage','coupons.manage','referrals.manage'])) {
      items.push({
        label: 'Promotions', icon: 'gift',
        children: filterTruthy([
          can('promotions.manage')  && { label: 'City Wide',   icon: 'pin',  route: '/promotions/city-wide' },
          can('promo_codes.manage') && { label: 'Promo Codes', icon: 'tag',  route: '/promotions/promo-codes' },
          can('coupons.manage')     && { label: 'Coupons',     icon: 'tag',  route: '/promotions/coupons' },
          can('referrals.manage')   && { label: 'Referrals',   icon: 'send', route: '/promotions/referrals' },
        ]),
      });
    }

    if (canAny(['trips.view','rides.map','rides.dispatch'])) {
      items.push({
        label: 'Rides', icon: 'car',
        children: filterTruthy([
          can('trips.view') && { label: 'All Rides', icon: 'car', route: '/rides/all' },
          can('rides.map')  && { label: 'Map View',  icon: 'map', route: '/rides/map' },
        ]),
      });
    }

    if (can('rides.dispatch')) items.push({ label: 'Manual Dispatch', icon: 'send', route: '/rides/manual-dispatch' });

    if (canAny(['settings.manage','fleets.manage','managers.manage','roles.manage'])) {
      items.push({
        label: 'Settings', icon: 'cog',
        children: filterTruthy([
          can('settings.manage') && { label: 'Operator Settings',    icon: 'cog',    route: '/settings/operator' },
          can('settings.manage') && { label: 'City Settings',        icon: 'pin',    route: '/settings/city' },
          can('settings.manage') && { label: 'Geofencing',           icon: 'map',    route: '/settings/geofencing' },
          can('fleets.manage')   && { label: 'Fleets',               icon: 'car',    route: '/settings/fleets' },
          can('managers.manage') && { label: 'Managers',             icon: 'users',  route: '/managers' },
          can('roles.manage')    && { label: 'Roles & Permissions',  icon: 'shield', route: '/roles-permissions' },
        ]),
      });
    }

    if (canAny(['analytics.view','reports.view'])) {
      items.push({
        label: 'Analytics', icon: 'chart-bar',
        children: filterTruthy([
          can('analytics.view') && { label: 'Real Time', icon: 'chart-line', route: '/analytics/real-time' },
          can('analytics.view') && { label: 'Graphs',    icon: 'chart-bar',  route: '/analytics/graphs' },
          can('reports.view')   && { label: 'Reports',   icon: 'chart-line', route: '/analytics/reports' },
        ]),
      });
    }

    if (can('safety.view'))  items.push({ label: 'Safety',  icon: 'shield',     route: '/safety' });
    if (can('reports.view')) items.push({ label: 'Reports', icon: 'chart-line', route: '/reports' });

    return [{ items }];
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
