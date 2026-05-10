import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  ridesOpen = true;
  driversOpen = true;
  settingsOpen = true;

  constructor(public router: Router) {}

  logout(): void {
    localStorage.removeItem('dreamcabs_token');
    localStorage.removeItem('dreamcabs_api_base');
    this.router.navigateByUrl('/signin');
  }

  get isAuthorized(): boolean {
    return !!localStorage.getItem('dreamcabs_token');
  }

  get isSigninRoute(): boolean {
    return this.router.url.startsWith('/signin');
  }

  get showNav(): boolean {
    // Requirement: if not authorized, show only the signin page without header links.
    return this.isAuthorized && !this.isSigninRoute;
  }
}
