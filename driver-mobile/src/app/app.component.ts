import { Component, OnInit } from '@angular/core';
import { DevLocationService } from './core/dev-location.service';
import { AuthService } from './core/auth.service';
import { PushService } from './core/push.service';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent implements OnInit {
  showDevBadge = false;

  // Startup routing (session check + active-trip resume) lives in the splash
  // page, which is the app's root route — see pages/splash/splash.page.ts.
  constructor(
    private devLocation: DevLocationService,
    private auth: AuthService,
    private push: PushService,
  ) {
    this.showDevBadge = this.devLocation.isEnabled();
  }

  ngOnInit(): void {
    // Re-register the FCM device token on every app open (not just at login),
    // so an already-signed-in phone keeps a valid delivery address in the
    // backend — and self-heals if the token was never saved or later rotated.
    // registerForUser() guards its own permission/token/errors, so this is a
    // safe no-op when notifications are denied or Firebase isn't available.
    if (this.auth.isLoggedIn()) {
      void this.push.registerForUser();
    }
  }
}
