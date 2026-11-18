import { Component } from '@angular/core';
import { NavController } from '@ionic/angular';
import { AuthService } from '../../../core/auth.service';
import { DriverTypeChoice, DriverTypeMemory } from './carpool-signup.models';

/**
 * Sign-up step 1 of 5: "How will you drive with Dream Cabs?"
 * (mockup screen 1). Commercial drivers go on to the existing wizard;
 * private car owners get the short carpool sign-up.
 */
@Component({
  selector: 'app-driver-type',
  templateUrl: './driver-type.page.html',
  styleUrls: ['./carpool-signup.page.scss'],
  standalone: false,
})
export class DriverTypePage {
  choice: DriverTypeChoice | null = null;

  constructor(
    private auth: AuthService,
    private nav: NavController,
  ) {}

  pick(choice: DriverTypeChoice): void {
    this.choice = choice;
  }

  continue(): void {
    if (!this.choice) return;
    DriverTypeMemory.set(this.auth.getUser()?.id, this.choice);
    if (this.choice === 'commercial') {
      void this.nav.navigateRoot('/profile', { animationDirection: 'forward' });
    } else {
      void this.nav.navigateForward('/carpool-signup/details');
    }
  }

  logout(): void {
    void this.auth.logout().then(() => this.nav.navigateRoot('/welcome', { animationDirection: 'back' }));
  }
}
