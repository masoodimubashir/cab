import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController, ToastController } from '@ionic/angular';
import { ApiService } from '../../core/api.service';

interface EmergencyContact {
  id: number;
  name: string;
  phone: string;
  relationship: string | null;
  is_primary: boolean;
}

/**
 * Per-user emergency contact list — used in SOS situations.
 *
 * Two ways to add a contact:
 *   1. Manual entry in the dialog (name + phone + relationship).
 *   2. "Pick from phone contacts" — uses the Web Contacts API
 *      (navigator.contacts.select). Works on Android Chrome; gracefully
 *      degrades to manual entry where unsupported.
 */
@Component({
  selector: 'app-emergency-contacts',
  templateUrl: './emergency-contacts.page.html',
  styleUrls: ['./emergency-contacts.page.scss'],
  standalone: false,
})
export class EmergencyContactsPage implements OnInit {
  contacts: EmergencyContact[] = [];
  loading = false;
  error: string | null = null;

  // Dialog state
  dialogOpen = false;
  saving = false;
  form: { id: number | null; name: string; phone: string; relationship: string; is_primary: boolean } = {
    id: null, name: '', phone: '', relationship: '', is_primary: false,
  };

  pickerSupported = false;

  constructor(
    private api: ApiService,
    private router: Router,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController,
  ) {}

  ngOnInit(): void {
    // Web Contacts API: navigator.contacts.select. Available on Android Chrome
    // / Edge, not on iOS Safari. We feature-detect and only show the picker
    // button where it'll actually work.
    const nav = navigator as any;
    this.pickerSupported = !!nav.contacts && typeof nav.contacts.select === 'function';
    this.refresh();
  }

  refresh(): void {
    this.loading = true;
    this.error = null;
    this.api.get<{ data: EmergencyContact[] }>('/me/emergency-contacts').subscribe({
      next: (res) => { this.contacts = res.data ?? []; this.loading = false; },
      error: (err) => { this.error = err?.error?.message || 'Could not load contacts.'; this.loading = false; },
    });
  }

  // ── Add / Edit ───────────────────────────────────────────────────

  openAdd(): void {
    this.form = { id: null, name: '', phone: '', relationship: '', is_primary: false };
    this.dialogOpen = true;
  }

  openEdit(c: EmergencyContact): void {
    this.form = {
      id: c.id,
      name: c.name,
      phone: c.phone,
      relationship: c.relationship || '',
      is_primary: c.is_primary,
    };
    this.dialogOpen = true;
  }

  /**
   * Open the OS contacts picker, then prefill the dialog with the chosen
   * contact's name + first phone number. The user still confirms before save.
   */
  async pickFromPhone(): Promise<void> {
    const nav = navigator as any;
    if (!nav.contacts?.select) {
      const t = await this.toastCtrl.create({
        message: 'Picking from contacts is not supported on this device.',
        duration: 2500, color: 'warning',
      });
      await t.present();
      return;
    }
    try {
      const picked = await nav.contacts.select(['name', 'tel'], { multiple: false });
      if (!Array.isArray(picked) || picked.length === 0) return;
      const c = picked[0];
      const name = Array.isArray(c.name) && c.name.length ? c.name[0] : '';
      const phone = Array.isArray(c.tel) && c.tel.length ? c.tel[0] : '';
      this.form = { id: null, name, phone, relationship: '', is_primary: false };
      this.dialogOpen = true;
    } catch (e) {
      // User dismissed the picker or browser blocked it — silent.
    }
  }

  submit(): void {
    this.error = null;
    if (!this.form.name.trim()) { this.error = 'Name is required.'; return; }
    if (!this.form.phone.trim()) { this.error = 'Phone is required.'; return; }

    const body = {
      name: this.form.name.trim(),
      phone: this.form.phone.trim(),
      relationship: this.form.relationship.trim() || null,
      is_primary: this.form.is_primary,
    };

    this.saving = true;
    const req = this.form.id
      ? this.api.patch<{ contact: EmergencyContact }>(`/me/emergency-contacts/${this.form.id}`, body)
      : this.api.post<{ contact: EmergencyContact }>('/me/emergency-contacts', body);

    req.subscribe({
      next: () => { this.saving = false; this.dialogOpen = false; this.refresh(); },
      error: (err) => { this.error = err?.error?.message || 'Could not save contact.'; this.saving = false; },
    });
  }

  // ── Delete ───────────────────────────────────────────────────────

  async confirmDelete(c: EmergencyContact): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Delete contact?',
      message: `${c.name} (${c.phone})`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Delete', role: 'destructive', handler: () => this.doDelete(c) },
      ],
    });
    await alert.present();
  }

  private doDelete(c: EmergencyContact): void {
    this.api.delete(`/me/emergency-contacts/${c.id}`).subscribe({
      next: () => this.refresh(),
      error: async (err) => {
        const t = await this.toastCtrl.create({
          message: err?.error?.message || 'Could not delete contact.',
          duration: 2500, color: 'danger',
        });
        await t.present();
      },
    });
  }

  back(): void {
    this.router.navigateByUrl('/tabs/more');
  }
}
