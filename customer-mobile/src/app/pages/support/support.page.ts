import { Component, OnInit } from '@angular/core';
import { ApiService } from '../../core/api.service';

interface SupportInfo {
  emergency_police_no: string | null;
  customer_support_no: string | null;
  driver_support_no: string | null;
  support_email: string | null;
}

interface Faq {
  q: string;
  a: string;
}

@Component({
  selector: 'app-support',
  templateUrl: './support.page.html',
  styleUrls: ['./support.page.scss'],
  standalone: false,
})
export class SupportPage implements OnInit {
  loading = false;
  error: string | null = null;
  support: SupportInfo | null = null;

  readonly faqs: Faq[] = [
    {
      q: 'How do I book a ride?',
      a: 'Choose pickup and drop locations, select the ride type, then confirm the booking. For fixed rides, choose the route, departure, boarding stop, and drop stop.',
    },
    {
      q: 'How do I track my driver?',
      a: 'Open your active ride screen after a driver is assigned. The map updates with the latest driver location when location tracking is available.',
    },
    {
      q: 'Can I cancel a booking?',
      a: 'Yes. Open the active ride or fixed booking details and use Cancel. Refund availability depends on the booking type and cancellation time.',
    },
    {
      q: 'How do fixed route bookings work?',
      a: 'Select a fixed route, pick a live departure, then choose your boarding and drop stops. You can book only from stops the vehicle has not already passed.',
    },
    {
      q: 'How do I manage emergency contacts?',
      a: 'Open Contact from the menu and add trusted people manually or from your phone contacts. They are used for SOS and safety support.',
    },
  ];

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = null;
    this.api.get<SupportInfo>('/support-info').subscribe({
      next: (res) => {
        this.support = res;
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Could not load support info.';
        this.loading = false;
      },
    });
  }

  get hasChannels(): boolean {
    return !!(
      this.support?.customer_support_no ||
      this.support?.support_email ||
      this.support?.emergency_police_no
    );
  }

  call(phone: string | null | undefined): void {
    if (!phone) return;
    window.location.href = `tel:${phone}`;
  }

  email(addr: string | null | undefined): void {
    if (!addr) return;
    window.location.href = `mailto:${addr}`;
  }

  report(): void {
    const to = this.support?.support_email || '';
    const subject = encodeURIComponent('Customer app - Report a problem');
    const body = encodeURIComponent(
      'Please describe the problem you are facing:\n\n\n- Sent from the DreamCabs customer app',
    );
    window.location.href = `mailto:${to}?subject=${subject}&body=${body}`;
  }
}
