import { Component, OnDestroy, OnInit } from '@angular/core';
import { NavController } from '@ionic/angular';
import { ApiService } from '../../../core/api.service';
import { AuthService } from '../../../core/auth.service';
import { CarpoolVehicle, DocumentRequirement, DriverMe } from './carpool-signup.models';

/**
 * Where a carpool driver lands after sign-up: under review, needs changes,
 * or approved. Until the carpool home arrives (M3) an approved driver sees a
 * short "you're approved" page here instead of the commercial dashboard.
 */
@Component({
  selector: 'app-carpool-status',
  templateUrl: './carpool-status.page.html',
  styleUrls: ['./carpool-signup.page.scss'],
  standalone: false,
})
export class CarpoolStatusPage implements OnInit, OnDestroy {
  loading = true;
  error: string | null = null;
  firstName = '';
  approval: 'pending' | 'approved' | 'rejected' | null = null;
  car: CarpoolVehicle | null = null;
  docs: DocumentRequirement[] = [];

  private poll: ReturnType<typeof setInterval> | null = null;

  constructor(
    private api: ApiService,
    private auth: AuthService,
    private nav: NavController,
  ) {}

  ngOnInit(): void {
    this.load();
    this.poll = setInterval(() => this.load(true), 20_000);
  }

  ngOnDestroy(): void {
    if (this.poll) clearInterval(this.poll);
  }

  load(silent = false): void {
    if (!silent) this.loading = true;
    this.api.get<DriverMe>('/drivers/me').subscribe({
      next: (me) => {
        this.loading = false;
        this.error = null;
        if (me.driver?.driver_type !== 'carpool') {
          void this.nav.navigateRoot('/profile');
          return;
        }
        this.firstName = (me.user?.name ?? '').split(' ')[0];
        this.approval = me.driver.approval_status;
        this.car = me.driver.carpool_vehicle ?? null;
        this.docs = (me.document_requirements ?? []).filter((d) => d.document_id !== null);
      },
      error: () => {
        this.loading = false;
        if (!silent) this.error = 'Could not load your status. Check your connection.';
      },
    });
  }

  get docsNeedingWork(): DocumentRequirement[] {
    return this.docs.filter((d) => d.status === 'missing' || d.status === 'rejected');
  }

  docLabel(d: DocumentRequirement): string {
    return { approved: 'Approved', pending: 'Being checked', rejected: 'Upload again', missing: 'Not sent' }[d.status];
  }

  fix(): void {
    void this.nav.navigateForward('/carpool-signup/details');
  }

  logout(): void {
    void this.auth.logout().then(() => this.nav.navigateRoot('/welcome', { animationDirection: 'back' }));
  }
}
