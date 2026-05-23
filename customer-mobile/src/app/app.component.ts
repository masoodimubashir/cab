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

  constructor(private devLocation: DevLocationService) {
    this.showDevBadge = this.devLocation.isEnabled();
  }
}
