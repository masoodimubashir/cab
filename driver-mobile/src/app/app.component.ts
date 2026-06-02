import { Component } from '@angular/core';
import { DevLocationService } from './core/dev-location.service';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent {
  showDevBadge = false;

  // Startup routing (session check + active-trip resume) lives in the splash
  // page, which is the app's root route — see pages/splash/splash.page.ts.
  constructor(private devLocation: DevLocationService) {
    this.showDevBadge = this.devLocation.isEnabled();
  }
}
