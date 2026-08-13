import { ChangeDetectionStrategy, Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';

/**
 * The shared, full-screen boarding-code prompt used by ALL ride types (private /
 * shuttle / fixed) so the rider sees the same thing everywhere. It pops up
 * automatically the moment a code arrives (the driver requested boarding), shows
 * the code as boxed digits, and the rider dismisses it after showing the driver.
 *
 * The code is system-generated and only ever appears on the rider's OWN device
 * (no SMS) — the whole point of the boarding check. A fresh code (e.g. a resend)
 * re-opens the prompt; dismissing the same code won't re-pop it.
 */
@Component({
  selector: 'app-boarding-code-prompt',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, IonicModule],
  template: `
    <div class="bcp-overlay" *ngIf="visible && code" (click)="dismiss()">
      <div class="bcp-card" (click)="$event.stopPropagation()">
        <span class="bcp-label">
          <ion-icon name="keypad-outline" aria-hidden="true"></ion-icon>
          {{ title }}
        </span>
        <strong class="bcp-digits">
          <i *ngFor="let d of digits">{{ d }}</i>
        </strong>
        <p class="bcp-hint">Read it out to your driver only when you're boarding the vehicle.</p>
        <p class="bcp-warn">
          <ion-icon name="shield-checkmark-outline" aria-hidden="true"></ion-icon>
          Don't share it with anyone before boarding.
        </p>
        <button type="button" class="bcp-btn" (click)="dismiss()">Got it</button>
      </div>
    </div>
  `,
  styles: [`
    .bcp-overlay {
      position: fixed; inset: 0; z-index: 9999;
      background: rgba(13, 27, 42, 0.62);
      display: flex; align-items: center; justify-content: center;
      padding: 24px;
      animation: bcp-fade 0.18s ease;
    }
    .bcp-card {
      width: 100%; max-width: 360px;
      background: #fff; border-radius: 22px;
      padding: 26px 22px 22px;
      text-align: center;
      box-shadow: 0 18px 50px rgba(13, 27, 42, 0.3);
      animation: bcp-pop 0.28s cubic-bezier(.2,.9,.3,1.2);
    }
    .bcp-label {
      display: inline-flex; align-items: center; gap: 7px;
      font-size: 12.5px; font-weight: 850; letter-spacing: 0.06em;
      text-transform: uppercase; color: #12B35B;
    }
    .bcp-label ion-icon { font-size: 17px; }
    .bcp-digits { display: flex; justify-content: center; gap: 10px; margin: 16px 0 4px; }
    .bcp-digits i {
      font-style: normal;
      width: 54px; height: 66px;
      display: flex; align-items: center; justify-content: center;
      border-radius: 16px; border: 2px solid #12B35B; background: #F2FBF6;
      font-size: 30px; font-weight: 900; color: #0D1B2A;
    }
    .bcp-hint { margin: 14px 4px 6px; font-size: 14px; color: #0D1B2A; line-height: 1.5; }
    .bcp-warn {
      display: inline-flex; align-items: center; gap: 6px;
      margin: 2px 0 18px; font-size: 12px; font-weight: 700; color: #C0392B;
    }
    .bcp-warn ion-icon { font-size: 15px; }
    .bcp-btn {
      width: 100%; height: 48px; border: none; border-radius: 14px;
      background: #12B35B; color: #fff; font-size: 16px; font-weight: 800;
    }
    .bcp-btn:active { transform: translateY(1px); }
    @keyframes bcp-fade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes bcp-pop { from { transform: scale(0.92); opacity: 0; } to { transform: scale(1); opacity: 1; } }
  `],
})
export class BoardingCodePromptComponent implements OnChanges {
  /** The active boarding code, or null when there isn't one. */
  @Input() code: string | null = null;
  @Input() title = 'Show this code to your driver';

  visible = false;
  private shownFor: string | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    if (!('code' in changes)) return;
    const code = this.code;
    if (code && code !== this.shownFor) {
      // A new code arrived — pop the prompt.
      this.visible = true;
      this.shownFor = code;
    } else if (!code) {
      this.visible = false;
      this.shownFor = null;
    }
  }

  get digits(): string[] {
    return this.code ? this.code.split('') : [];
  }

  dismiss(): void {
    this.visible = false;
  }
}
