import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { FirebaseMessaging } from '@capacitor-firebase/messaging';
import { GeolocationService } from '../../core/geolocation.service';

/**
 * Welcome screen shown on first launch. Explains why the app needs location
 * + other permissions, then triggers a single "Grant Permissions" prompt.
 *
 * Once granted (or if the user has already granted in a previous session),
 * we mark `dreamcabs_permissions_intro_done` and route to /auth/login.
 */
@Component({
  selector: 'app-intro',
  templateUrl: './intro.page.html',
  styleUrls: ['./intro.page.scss'],
  standalone: false,
})
export class IntroPage implements OnInit {
  loading = false;
  error: string | null = null;

  constructor(private router: Router, private geo: GeolocationService) {}

  ngOnInit(): void {
    if (localStorage.getItem('dreamcabs_permissions_intro_done') === '1') {
      void this.router.navigateByUrl('/auth/login', { replaceUrl: true });
    }
  }

  async grant(): Promise<void> {
    this.error = null;
    this.loading = true;
    try {
      await this.geo.requestPermissions();
      try {
        await FirebaseMessaging.requestPermissions();
      } catch {
        /* ignore — push notifications are nice-to-have */
      }

      localStorage.setItem('dreamcabs_permissions_intro_done', '1');
      await this.router.navigateByUrl('/auth/login', { replaceUrl: true });
    } catch (e) {
      this.error = (e as Error)?.message || 'Could not request permissions.';
    } finally {
      this.loading = false;
    }
  }
}
