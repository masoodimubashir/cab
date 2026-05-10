import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from './core/api.service';
import { AuthService } from './core/auth.service';
import { BackgroundLocationService } from './core/background-location.service';

interface ActiveTrip {
  id: number;
  status: string;
}

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent implements OnInit {
  constructor(
    private auth: AuthService,
    private api: ApiService,
    private router: Router,
    private bgLocation: BackgroundLocationService
  ) {}

  ngOnInit(): void {
    if (!this.auth.isLoggedIn()) return;
    const roles = this.auth.getUser()?.roles ?? [];
    if (!roles.includes('driver')) return;

    this.api.get<{ trip: ActiveTrip | null }>('/drivers/me/active-trip').subscribe({
      next: (res) => {
        const trip = res?.trip;
        if (!trip) return;
        void this.bgLocation.start(trip.id);
        this.router.navigateByUrl(`/tabs/rides`);
      },
      error: () => {
        // Silent: endpoint may be unreachable on cold start; user can navigate manually.
      },
    });
  }
}
