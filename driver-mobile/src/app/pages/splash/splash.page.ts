import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { BackgroundLocationService } from '../../core/background-location.service';
import { DriverOnboardingDraftService } from '../../core/driver-onboarding-draft.service';

interface ActiveTrip {
  id: number;
  status: string;
  route_departure_id?: number | null;
}

@Component({
  selector: 'app-splash',
  templateUrl: './splash.page.html',
  styleUrls: ['./splash.page.scss'],
  standalone: false,
})
export class SplashPage implements OnInit {
  constructor(
    private auth: AuthService,
    private api: ApiService,
    private router: Router,
    private bgLocation: BackgroundLocationService,
    private draft: DriverOnboardingDraftService,
  ) {}

  ngOnInit() {
    // Beautiful immersive delay to show the cinematic entrance animation,
    // and then route the session securely.
    setTimeout(() => this.route(), 2500);
  }

  /**
   * Decide the first screen after the splash:
   *   - Not logged in            → /welcome
   *   - Logged in, driver on private trip → resume /tabs/rides (and restart bg location)
   *   - Logged in, driver on fixed trip   → resume /tabs/fixed
   *   - Logged in otherwise       → /tabs/dashboard (ApprovedDriverGuard takes it
   *                                 from there to registration/pending if needed)
   */
  private route(): void {
    if (!this.auth.isLoggedIn()) {
      void this.router.navigateByUrl('/welcome', { replaceUrl: true });
      return;
    }

    const roles = this.auth.getUser()?.roles ?? [];
    if (!roles.includes('driver')) {
      void this.router.navigateByUrl('/profile?next=registration', { replaceUrl: true });
      return;
    }

    this.api.get<{ trip: ActiveTrip | null }>('/drivers/me/active-trip').subscribe({
      next: (res) => {
        const trip = res?.trip;
        if (trip) {
          if (trip.route_departure_id != null) {
            void this.router.navigateByUrl('/tabs/fixed', { replaceUrl: true });
          } else {
            void this.bgLocation.start(trip.id);
            void this.router.navigateByUrl('/tabs/rides', { replaceUrl: true });
          }
        } else {
          void this.router.navigateByUrl('/tabs/dashboard', { replaceUrl: true });
        }
      },
      error: () => {
        // Endpoint may be unreachable on cold start; fall back to the dashboard.
        void this.router.navigateByUrl('/tabs/dashboard', { replaceUrl: true });
      },
    });
  }
}
