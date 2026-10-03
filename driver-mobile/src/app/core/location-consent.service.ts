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
    this.acceptedToken = token;
    return true;
  }
}
