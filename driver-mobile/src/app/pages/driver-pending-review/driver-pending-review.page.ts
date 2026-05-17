import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ApprovedDriverGuard } from '../../core/approved-driver.guard';

/**
 * Locked "Your documents are under review" screen.
 *
 * Drivers land here after they've uploaded their documents but the operator
 * hasn't approved them yet. The page intentionally has no navigation away
 * other than Logout — every other surface in the app is also gated by
 * `pendingReviewGuard`, so even if the driver hits a deep link they'll bounce
 * back here.
 *
 * The page polls /drivers/me every 15s; once approval_status flips to
 * 'approved' it auto-redirects to /tabs/dashboard.
 */
@Component({
  selector: 'app-driver-pending-review',
  templateUrl: './driver-pending-review.page.html',
  styleUrls: ['./driver-pending-review.page.scss'],
  standalone: false,
})
export class DriverPendingReviewPage implements OnInit, OnDestroy {
  status: 'uploaded' | 'approved' | 'rejected' | 'unknown' = 'unknown';
  hasRejected = false;
  loading = true;
  private pollHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    private api: ApiService,
    private auth: AuthService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.refresh();
    // Light-touch polling so a freshly-approved driver doesn't have to manually
    // refresh. 15s is gentle enough that battery / data impact is negligible.
    this.pollHandle = setInterval(() => this.refresh(true), 15000);
  }

  ngOnDestroy(): void {
    if (this.pollHandle) clearInterval(this.pollHandle);
  }

  refresh(silent = false): void {
    if (!silent) this.loading = true;
    this.api.get<{ driver: { approval_status: string } | null; documents: { status: string }[] }>(
      '/drivers/me',
    ).subscribe({
      next: (res) => {
        const approval = res.driver?.approval_status ?? null;
        const docs = res.documents ?? [];
        this.hasRejected = docs.some((d) => d.status === 'rejected');

        if (approval === 'approved') {
          // Approved → release the lock and go to dashboard.
          ApprovedDriverGuard.setStateApproved();
          this.router.navigateByUrl('/tabs/dashboard', { replaceUrl: true });
          return;
        }
        if (docs.length === 0) {
          // Edge case: somehow they reached this page without uploading anything.
          // Send them back to the documents step.
          ApprovedDriverGuard.setStateRegistering();
          this.router.navigateByUrl('/driver-registration', { replaceUrl: true });
          return;
        }
        ApprovedDriverGuard.setStatePending();
        this.status = this.hasRejected ? 'rejected' : 'uploaded';
        this.loading = false;
      },
      error: () => { this.loading = false; },
    });
  }

  logout(): void {
    this.auth.logout();
    ApprovedDriverGuard.clearCache();
    this.router.navigateByUrl('/auth/login', { replaceUrl: true });
  }

  // Driver fixes a rejected doc → bounces them back to the documents step.
  // Approval check on the next /drivers/me brings them back here automatically.
  fixDocuments(): void {
    this.router.navigateByUrl('/driver-registration', { replaceUrl: true });
  }
}
