import { Component, OnDestroy, OnInit } from '@angular/core';
import { NavController } from '@ionic/angular';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ApiService } from '../../../core/api.service';
import { AuthService } from '../../../core/auth.service';
import { CarpoolApiService } from '../carpool-api.service';
import { CarpoolPlan, CarpoolPlanState } from '../carpool.models';
import { DocumentRequirement, DriverMe } from './carpool-signup.models';
import { ApprovedSeen, StatusView, docProgress, statusView } from './signup-look';

/**
 * Where a carpool driver lands after sign-up (mockup 1f and 1g, new look, W13):
 * being checked, documents to fix, or approved. The approved page shows once,
 * then the driver goes straight to Home. While the carpool switch is off an
 * approved driver sees "Carpool opens soon" instead of a dead end.
 */
@Component({
  selector: 'app-carpool-status',
  templateUrl: './carpool-status.page.html',
  styleUrls: ['../driver/carpool-driver.scss', './carpool-signup-look.scss'],
  standalone: false,
})
export class CarpoolStatusPage implements OnInit, OnDestroy {
  loading = true;
  error: string | null = null;
  firstName = '';
  initials = '';
  view: StatusView | null = null;
  docs: DocumentRequirement[] = [];
  plan: CarpoolPlanState | null = null;
  plans: CarpoolPlan[] = [];

  private poll: ReturnType<typeof setInterval> | null = null;

  constructor(
    private api: ApiService,
    private auth: AuthService,
    private nav: NavController,
    private carpool: CarpoolApiService,
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
        if (me.driver?.driver_type !== 'carpool') {
          this.loading = false;
          void this.nav.navigateRoot('/profile');
          return;
        }
        const name = (me.user?.name ?? '').trim();
        this.firstName = name.split(/\s+/)[0] ?? '';
        this.initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
        this.docs = me.document_requirements ?? [];
        const approval = me.driver.approval_status;
        if (approval !== 'approved') {
          this.show(statusView({ approval, docs: this.docs, carpoolOn: false, hasPlan: false, seenApproved: false }));
          return;
        }
        forkJoin({
          config: this.carpool.config(true).pipe(catchError(() => of(null))),
          plan: this.carpool.planState().pipe(catchError(() => of(null))),
          plans: this.carpool.plans().pipe(catchError(() => of([] as CarpoolPlan[]))),
        }).subscribe(({ config, plan, plans }) => {
          this.plan = plan;
          this.plans = plans;
          // The id from this answer, not the stored login: it is always there.
          const userId = me.user?.id ?? this.auth.getUser()?.id;
          this.show(statusView({
            approval, docs: this.docs, carpoolOn: !!config?.enabled, hasPlan: !!plan?.plan, seenApproved: ApprovedSeen.get(userId),
          }));
          if (this.view === 'approved-no-plan' || this.view === 'approved-has-plan') ApprovedSeen.set(userId);
        });
      },
      error: () => {
        this.loading = false;
        if (!silent) this.error = 'Could not load your status. Check your connection and pull down to try again.';
      },
    });
  }

  private show(view: StatusView): void {
    this.loading = false;
    this.error = null;
    if (view === 'home') {
      void this.nav.navigateRoot('/carpool/home');
      return;
    }
    // An approved page already on screen stays until the driver taps on, even after it is marked seen.
    if ((this.view === 'approved-no-plan' || this.view === 'approved-has-plan') && view !== 'opens-soon') return;
    this.view = view;
  }

  get realDocs(): DocumentRequirement[] {
    return this.docs.filter((d) => d.document_id !== null);
  }

  get progress(): { approved: number; total: number; percent: number } {
    return docProgress(this.docs);
  }

  get cheapest(): CarpoolPlan | null {
    return this.plans.length ? this.plans.reduce((a, b) => (b.amount < a.amount ? b : a)) : null;
  }

  get hero(): { chip: string; icon: string; title: string; sub: string } {
    const toFix = this.realDocs.filter((d) => d.status === 'missing' || d.status === 'rejected').length;
    switch (this.view) {
      case 'fix':
        return { chip: 'Action needed', icon: 'alert-circle-outline', title: toFix === 1 ? '1 document to fix' : `${toFix} documents to fix`, sub: "Send them again and we'll recheck." };
      case 'approved-no-plan':
        return { chip: 'Approved', icon: 'checkmark-circle', title: "You're approved!", sub: 'Pick a plan to start publishing.' };
      case 'approved-has-plan':
        return { chip: 'Approved', icon: 'checkmark-circle', title: "You're all set!", sub: 'Time for your first carpool.' };
      case 'opens-soon':
        return { chip: 'Approved', icon: 'checkmark-circle', title: 'Carpool opens soon', sub: "We'll notify you when you can publish." };
      default:
        return { chip: 'Being checked', icon: 'time-outline', title: "We're checking your sign-up", sub: 'Usually within a day.' };
    }
  }

  docLabel(d: DocumentRequirement): string {
    return { approved: 'Approved', pending: 'Checking', rejected: 'Rejected', missing: 'Not sent' }[d.status];
  }

  docIcon(d: DocumentRequirement): string {
    const n = d.name.toLowerCase();
    if (n.includes('licen')) return 'card-outline';
    if (n.includes('insur')) return 'shield-checkmark-outline';
    if (n.includes('id') && !n.includes('rc')) return 'person-outline';
    return 'document-text-outline';
  }

  /** The admin's reason for a rejected image, shown under the document. */
  reason(d: DocumentRequirement): string | null {
    if (d.status !== 'rejected') return null;
    return d.slots?.find((s) => s.rejection_reason)?.rejection_reason ?? null;
  }

  fmt(iso: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    return `${d.getDate()} ${d.toLocaleString('en', { month: 'short' })}`;
  }

  fix(): void {
    void this.nav.navigateForward('/carpool-signup/documents');
  }

  /** Every state has a bottom bar except while leaving for Home. */
  get hasDock(): boolean {
    return !!this.view && this.view !== 'home';
  }

  goHome(): void {
    void this.nav.navigateRoot('/carpool/home');
  }

  logout(): void {
    this.carpool.reset();
    void this.auth.logout().then(() => this.nav.navigateRoot('/welcome', { animationDirection: 'back' }));
  }
}
