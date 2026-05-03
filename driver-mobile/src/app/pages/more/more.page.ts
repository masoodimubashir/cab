import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-more',
  templateUrl: './more.page.html',
  styleUrls: ['./more.page.scss'],
  standalone: false,
})
export class MorePage {
  constructor(
    public auth: AuthService,
    private router: Router
  ) {}

  signOut(): void {
    this.auth.logout();
    this.router.navigateByUrl('/auth/login', { replaceUrl: true });
  }

  goRegistration(): void {
    this.router.navigateByUrl('/driver-registration');
  }

  goPerformance(): void {
    this.router.navigateByUrl('/performance');
  }
}
