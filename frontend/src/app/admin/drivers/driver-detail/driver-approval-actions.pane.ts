import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonComponent } from '../../../ui';

export type DriverApprovalStatus = 'pending' | 'approved' | 'rejected';
export type PayoutAccountStatus = 'none' | 'pending' | 'verified' | 'rejected';

@Component({
  selector: 'app-driver-approval-actions-pane',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ButtonComponent],
  template: `
    <footer class="bar">
      <div class="bar__info">
        <p class="muted small">
          Approve once every required document is approved.
          Rejecting keeps the driver out of dispatch.
        </p>
        <p class="payout" [ngClass]="'payout--' + (payoutStatus || 'none')">
          <span class="payout__dot"></span>
          Payout account:
          <strong>{{ payoutLabel }}</strong>
        </p>
      </div>
      <div class="bar__actions">
        <tm-button
          variant="danger"
          icon="x"
          [disabled]="approvalStatus === 'rejected' || busy"
          (clicked)="reject.emit()"
        >Reject driver</tm-button>
        <tm-button
          variant="green"
          icon="check"
          [disabled]="approvalStatus === 'approved' || busy"
          (clicked)="approve.emit()"
        >Approve driver</tm-button>
      </div>
    </footer>
  `,
  styles: [`
    :host { display: block; }
    .bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--tm-space-3);
      padding: var(--tm-space-4) var(--tm-space-5);
      background: var(--tm-surface);
      border-top: 1px solid var(--tm-line);
      flex-wrap: wrap;
    }
    .bar__info { display: flex; flex-direction: column; gap: 6px; }
    .muted { color: var(--tm-text-muted); margin: 0; }
    .small { font-size: 12px; line-height: 1.4; max-width: 38ch; }
    .payout {
      display: flex; align-items: center; gap: 6px;
      margin: 0; font-size: 12px; color: var(--tm-text-muted);
    }
    .payout strong { color: var(--tm-text); font-weight: 600; }
    .payout__dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: var(--tm-text-muted); flex: 0 0 auto;
    }
    .payout--verified .payout__dot { background: var(--tm-green, #16a34a); }
    .payout--pending .payout__dot  { background: var(--tm-amber, #d97706); }
    .payout--rejected .payout__dot { background: var(--tm-red, #dc2626); }
    .bar__actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    @media (max-width: 540px) {
      .bar { padding: var(--tm-space-3) var(--tm-space-4); }
      .bar__actions { flex: 1; justify-content: flex-end; }
    }
  `],
})
export class DriverApprovalActionsPaneComponent {
  @Input() approvalStatus: DriverApprovalStatus | null = null;
  @Input() payoutStatus: PayoutAccountStatus | null = null;
  @Input() busy = false;
  @Output() approve = new EventEmitter<void>();
  @Output() reject = new EventEmitter<void>();

  get payoutLabel(): string {
    switch (this.payoutStatus) {
      case 'verified': return 'Verified — auto-paid';
      case 'pending': return 'Pending verification';
      case 'rejected': return 'Rejected — needs fixing';
      default: return 'Not set up';
    }
  }
}
