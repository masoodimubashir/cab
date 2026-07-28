import { Component, OnInit } from '@angular/core';
import { AuthService } from './core/auth.service';
import { PushService } from './core/push.service';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent implements OnInit {
  constructor(
    private auth: AuthService,
    private push: PushService,
  ) {}

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
