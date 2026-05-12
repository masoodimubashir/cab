import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController, ToastController } from '@ionic/angular';
import { ApiService } from '../../core/api.service';

interface SavedLocation {
  id: number;
  label: string;
  address: string;
  lat: number;
  lng: number;
  icon: string | null;
}

/**
 * Customer's saved locations (Home, Office, etc.). Manual lat/lng entry for
 * now — the booking screen's address autocomplete will later let users tap
 * "Save this place" to add a row without typing coordinates.
 */
@Component({
  selector: 'app-saved-locations',
  templateUrl: './saved-locations.page.html',
  styleUrls: ['./saved-locations.page.scss'],
  standalone: false,
})
export class SavedLocationsPage implements OnInit {
  rows: SavedLocation[] = [];
  loading = false;
  error: string | null = null;

  dialogOpen = false;
  saving = false;
  form: { id: number | null; label: string; address: string; lat: number | null; lng: number | null; icon: string } = {
    id: null, label: '', address: '', lat: null, lng: null, icon: '',
  };

  constructor(
    private api: ApiService,
    private router: Router,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController,
  ) {}

  ngOnInit(): void { this.refresh(); }

  refresh(): void {
    this.loading = true;
    this.error = null;
    this.api.get<{ data: SavedLocation[] }>('/me/saved-locations').subscribe({
      next: (res) => { this.rows = res.data ?? []; this.loading = false; },
      error: (err) => { this.error = err?.error?.message || 'Could not load saved locations.'; this.loading = false; },
    });
  }

  openAdd(): void {
    this.form = { id: null, label: '', address: '', lat: null, lng: null, icon: '' };
    this.dialogOpen = true;
  }

  openEdit(l: SavedLocation): void {
    this.form = {
      id: l.id, label: l.label, address: l.address,
      lat: l.lat, lng: l.lng, icon: l.icon || '',
    };
    this.dialogOpen = true;
  }

  submit(): void {
    this.error = null;
    if (!this.form.label.trim()) { this.error = 'Label is required.'; return; }
    if (!this.form.address.trim()) { this.error = 'Address is required.'; return; }
    if (this.form.lat == null || this.form.lng == null) {
      this.error = 'Latitude and longitude are required.';
      return;
    }

    const body = {
      label: this.form.label.trim(),
      address: this.form.address.trim(),
      lat: this.form.lat,
      lng: this.form.lng,
      icon: this.form.icon.trim() || null,
    };

    this.saving = true;
    const req = this.form.id
      ? this.api.patch<{ location: SavedLocation }>(`/me/saved-locations/${this.form.id}`, body)
      : this.api.post<{ location: SavedLocation }>('/me/saved-locations', body);
    req.subscribe({
      next: () => { this.saving = false; this.dialogOpen = false; this.refresh(); },
      error: (err) => { this.error = err?.error?.message || 'Could not save.'; this.saving = false; },
    });
  }

  async confirmDelete(l: SavedLocation): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Delete this saved location?',
      message: l.label + ' — ' + l.address,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Delete', role: 'destructive', handler: () => this.doDelete(l) },
      ],
    });
    await alert.present();
  }

  private doDelete(l: SavedLocation): void {
    this.api.delete(`/me/saved-locations/${l.id}`).subscribe({
      next: () => this.refresh(),
      error: async (err) => {
        const t = await this.toastCtrl.create({
          message: err?.error?.message || 'Could not delete.',
          duration: 2500, color: 'danger',
        });
        await t.present();
      },
    });
  }

  back(): void { this.router.navigateByUrl('/customer-tabs/more'); }
}
