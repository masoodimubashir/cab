import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-splash',
  templateUrl: './splash.page.html',
  styleUrls: ['./splash.page.scss'],
  standalone: false,
})
export class SplashPage implements OnInit {
  constructor(
    private auth: AuthService,
    private router: Router
  ) {}

  private homeRouteForCurrentUser(): string {
    return '/customer-tabs/book';
  }

  ngOnInit() {
    // Beautiful immersive delay to show the cinematic entrance animation,
    // and then route the session securely.
    setTimeout(() => {
      if (this.auth.isLoggedIn()) {
        void this.router.navigateByUrl(this.homeRouteForCurrentUser(), { replaceUrl: true });
      } else {
        void this.router.navigateByUrl('/welcome', { replaceUrl: true });
      }
    }, 2500);
  }
}
