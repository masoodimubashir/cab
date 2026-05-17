import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterOutlet, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { AuthService } from './core/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit {
  ridesOpen = true;
  driversOpen = true;
  settingsOpen = true;
  analyticsOpen = true;
  promotionsOpen = true;

  constructor(public router: Router, public auth: AuthService) {}

  ngOnInit(): void {
    // After signin we have a token; refresh the manager profile from the
    // server so cached permissions / city locks stay in sync.
    if (this.isAuthorized) {
      this.auth.ensureLoaded().subscribe();
    }
    // On every navigation also refresh if we landed back here after signing in.
    this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(() => {
        if (this.isAuthorized && !this.auth.profile) {
          this.auth.ensureLoaded().subscribe();
        }
      });
  }

  logout(): void {
    localStorage.removeItem('dreamcabs_token');
    localStorage.removeItem('dreamcabs_api_base');
    this.auth.clear();
    this.router.navigateByUrl('/signin');
  }

  /** Convenience for the template — hides sidebar entries the user can't reach. */
  can(slug: string): boolean { return this.auth.hasPermission(slug); }
  canAny(slugs: string[]): boolean { return this.auth.hasAnyPermission(slugs); }

  get isAuthorized(): boolean {
    return !!localStorage.getItem('dreamcabs_token');
  }

  get isSigninRoute(): boolean {
    return this.router.url.startsWith('/signin');
  }

  get showNav(): boolean {
    return this.isAuthorized && !this.isSigninRoute;
  }

  get scopedCityName(): string | null {
    const p = this.auth.profile;
    if (!p || p.is_super_admin) return null;
    return p.manager_city_name;
  }
}
