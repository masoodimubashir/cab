import { Injectable } from '@angular/core';
import { AlertController } from '@ionic/angular';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class LocationConsentService {
  private acceptedToken: string | null = null;
  private pending: Promise<boolean> | null = null;

  constructor(private alerts: AlertController, private auth: AuthService) {}

  async ensure(): Promise<boolean> {
    const token = this.auth.getToken();
    if (!token) return false;
    if (this.acceptedToken === token) return true;
    if (this.pending) return this.pending;
    this.pending = this.prompt(token);
    try { return await this.pending; } finally { this.pending = null; }
  }

  private async prompt(token: string): Promise<boolean> {
    const alert = await this.alerts.create({
      header: 'Location while on duty',
      message: 'DreamCabs Driver collects and sends your precise location to DreamCabs while you are online or working on a ride, including in the background when the app is minimized or your screen is locked. This enables nearby ride requests, pickup checks and live trip tracking for your passengers and DreamCabs administrators. Sign out to stop all tracking. Going offline stops dispatch tracking; ride tracking ends when the ride ends.',
      backdropDismiss: false,
      buttons: [
        { text: 'Not now', role: 'cancel' },
        { text: 'Continue', role: 'confirm' },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    if (role !== 'confirm' || this.auth.getToken() !== token) return false;
    this.acceptedToken = token;
    return true;
  }
}
