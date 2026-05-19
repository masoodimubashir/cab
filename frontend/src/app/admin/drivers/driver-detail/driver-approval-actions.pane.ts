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

@Component({
  selector: 'app-driver-approval-actions-pane',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ButtonComponent],
  template: `
    <footer class="bar">
      <p class="muted small">
        Approve once every required document is approved.
        Rejecting keeps the driver out of dispatch.
      </p>
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
    .muted { color: var(--tm-text-muted); margin: 0; }
    .small { font-size: 12px; line-height: 1.4; max-width: 38ch; }
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
  @Input() busy = false;
  @Output() approve = new EventEmitter<void>();
  @Output() reject = new EventEmitter<void>();
}
