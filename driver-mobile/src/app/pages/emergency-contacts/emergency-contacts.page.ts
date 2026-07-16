import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController, ToastController } from '@ionic/angular';
import { Capacitor } from '@capacitor/core';
import { Contacts } from '@capacitor-community/contacts';
import { ApiService } from '../../core/api.service';

interface EmergencyContact {
  id: number;
  name: string;
  phone: string;
  relationship: string | null;
  is_primary: boolean;
}

/**
 * Driver's emergency contacts — the trusted friends/family we can reach in an
 * SOS. Same backend endpoint and UI as the customer app so the two stay
 * identical (wording, styling, motion, icons).
 *
 * Two ways to add a contact:
 *   1. Manual entry in the sheet (name + country code + phone + relationship).
 *   2. "Choose from device" — native OS contact picker via the
 *      @capacitor-community/contacts plugin. The plugin gates the picker
 *      behind the Contacts permission on both Android and iOS, so we
 *      request it before opening.
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

  dialogOpen = false;
  saving = false;
  form: {
    id: number | null;
    name: string;
    countryCode: string;
    phone: string;
    relationship: string;
    is_primary: boolean;
  } = { id: null, name: '', countryCode: '91', phone: '', relationship: '', is_primary: false };

  // Country-code picker (India default). Codes are checked longest-first when
  // parsing a number picked from the device.
  showCountryPicker = false;
  countries: { name: string; code: string; flag: string }[] = [
    { name: 'India', code: '91', flag: '🇮🇳' },
    { name: 'United States', code: '1', flag: '🇺🇸' },
    { name: 'United Kingdom', code: '44', flag: '🇬🇧' },
    { name: 'United Arab Emirates', code: '971', flag: '🇦🇪' },
    { name: 'Saudi Arabia', code: '966', flag: '🇸🇦' },
    { name: 'Pakistan', code: '92', flag: '🇵🇰' },
    { name: 'Bangladesh', code: '880', flag: '🇧🇩' },
    { name: 'Nepal', code: '977', flag: '🇳🇵' },
    { name: 'Sri Lanka', code: '94', flag: '🇱🇰' },
    { name: 'Australia', code: '61', flag: '🇦🇺' },
    { name: 'Canada', code: '1', flag: '🇨🇦' },
    { name: 'Singapore', code: '65', flag: '🇸🇬' },
    { name: 'Malaysia', code: '60', flag: '🇲🇾' },
    { name: 'Qatar', code: '974', flag: '🇶🇦' },
    { name: 'Kuwait', code: '965', flag: '🇰🇼' },
    { name: 'Oman', code: '968', flag: '🇴🇲' },
  ];

  constructor(
    private api: ApiService,
    private router: Router,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController,
  ) {}

  ngOnInit(): void {
    this.refresh();
  }

  callNumber(phone: string | null | undefined): void {
    if (!phone) return;
    window.location.href = `tel:${phone}`;
  }

  refresh(): void {
    this.loading = true;
    this.error = null;
    this.api.get<{ data: EmergencyContact[] }>('/me/emergency-contacts').subscribe({
      next: (res) => { this.contacts = res.data ?? []; this.loading = false; },
      error: (err) => { this.error = err?.error?.message || 'Could not load contacts.'; this.loading = false; },
    });
  }

  openAdd(): void {
    this.form = { id: null, name: '', countryCode: '91', phone: '', relationship: '', is_primary: false };
    this.dialogOpen = true;
  }

  openEdit(c: EmergencyContact): void {
    const { countryCode, local } = this.splitPhone(c.phone);
    this.form = {
      id: c.id, name: c.name, countryCode, phone: local,
      relationship: c.relationship || '', is_primary: c.is_primary,
    };
    this.dialogOpen = true;
  }

  // ── Country code + phone helpers ─────────────────────────────────
  get selectedCountry(): { name: string; code: string; flag: string } {
    return this.countries.find((c) => c.code === this.form.countryCode) ?? this.countries[0];
  }

  selectCountry(c: { code: string }): void {
    this.form.countryCode = c.code;
    this.showCountryPicker = false;
  }

  /** Keep the phone box digits-only and capped at 10. */
  onPhoneInput(): void {
    this.form.phone = (this.form.phone || '').replace(/\D/g, '').slice(0, 10);
  }

  /**
   * Split a raw/full phone string into a dial code + local number. Used when
   * editing or when a contact is picked from the device — whatever country
   * code the number carries lands in the country selector.
   */
  private splitPhone(raw: string | null | undefined): { countryCode: string; local: string } {
    let p = (raw || '').replace(/[\s\-()]/g, '');
    if (p.startsWith('+')) {
      const digits = p.slice(1);
      // Longest dial-code prefix wins (e.g. 971 before 9).
      const codes = [...new Set(this.countries.map((c) => c.code))].sort((a, b) => b.length - a.length);
      const match = codes.find((code) => digits.startsWith(code) && digits.length - code.length >= 6);
      if (match) return { countryCode: match, local: digits.slice(match.length).slice(-10) };
      return { countryCode: '91', local: digits.slice(-10) };
    }
    if (p.startsWith('0')) p = p.slice(1);
    // 12 digits starting with 91 → India without the +.
    if (p.length > 10 && p.startsWith('91')) return { countryCode: '91', local: p.slice(2).slice(-10) };
    return { countryCode: this.form?.countryCode || '91', local: p.slice(-10) };
  }

  /**
   * Open the phone's native contact picker (Capacitor contacts plugin) and
   * pre-fill the add form with the chosen name + number. The plugin rejects
   * unless the Contacts permission is granted (Android and iOS alike), so
   * request it first and tell the user exactly what went wrong instead of a
   * generic failure toast. iOS 18 "limited" access still allows picking.
   */
  async pickFromPhone(): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      await this.pickerToast('Picking from contacts only works in the installed app — please add the contact manually.');
      this.openAdd();
      return;
    }
    try {
      const status = await Contacts.requestPermissions();
      if (status.contacts !== 'granted' && status.contacts !== 'limited') {
        await this.pickerToast('Contacts permission is blocked. Allow Contacts for this app in your phone Settings, then try again.');
        return;
      }
      const res = await Contacts.pickContact({ projection: { name: true, phones: true } });
      const c = res?.contact;
      if (!c) return; // cancelled
      const name = c.name?.display ?? '';
      const rawPhone = (c.phones?.find((p) => p.number)?.number) ?? '';
      const { countryCode, local } = this.splitPhone(rawPhone);
      this.form = { id: null, name, countryCode, phone: local, relationship: '', is_primary: false };
      this.dialogOpen = true;
    } catch {
      await this.pickerToast('Could not open the contacts picker on this device.');
    }
  }

  private async pickerToast(message: string): Promise<void> {
    const t = await this.toastCtrl.create({ message, duration: 3000, color: 'warning' });
    await t.present();
  }

  submit(): void {
    this.error = null;
    const local = (this.form.phone || '').replace(/\D/g, '');
    if (!this.form.name.trim()) { this.error = 'Name is required.'; return; }
    if (!local) { this.error = 'Phone is required.'; return; }
    if (local.length > 10) { this.error = 'Phone number cannot be more than 10 digits.'; return; }
    const body = {
      name: this.form.name.trim(),
      phone: `+${this.form.countryCode}${local}`,
      relationship: this.form.relationship.trim() || null,
      is_primary: this.form.is_primary,
    };
    this.saving = true;
    const req = this.form.id
      ? this.api.patch<{ contact: EmergencyContact }>(`/me/emergency-contacts/${this.form.id}`, body)
      : this.api.post<{ contact: EmergencyContact }>('/me/emergency-contacts', body);
    req.subscribe({
      next: () => { this.saving = false; this.dialogOpen = false; this.refresh(); },
      error: (err) => { this.error = err?.error?.message || 'Could not save.'; this.saving = false; },
    });
  }

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
          message: err?.error?.message || 'Could not delete.',
          duration: 2500, color: 'danger',
        });
        await t.present();
      },
    });
  }

  back(): void { this.router.navigateByUrl('/tabs/dashboard'); }
}
