import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { FirebaseMessaging } from '@capacitor-firebase/messaging';
import { GeolocationService } from '../../core/geolocation.service';

/**
 * Driver-app welcome screen — mirrors customer-app/intro.
 * Shows once until permissions have been granted.
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
      try {
        await this.geo.requestPermissions();
      } catch {
        /* ignore */
      }
      try {
        await FirebaseMessaging.requestPermissions();
      } catch {
        /* ignore */
      }
      localStorage.setItem('dreamcabs_permissions_intro_done', '1');
      await this.router.navigateByUrl('/auth/login', { replaceUrl: true });
    } catch (e) {
      this.error = (e as Error)?.message || 'Could not proceed.';
    } finally {
      this.loading = false;
    }
  }

  async skip(): Promise<void> {
    localStorage.setItem('dreamcabs_permissions_intro_done', '1');
    await this.router.navigateByUrl('/auth/login', { replaceUrl: true });
  }
}
