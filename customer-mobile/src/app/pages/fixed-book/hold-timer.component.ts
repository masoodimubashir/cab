import {
  ChangeDetectionStrategy, ChangeDetectorRef,
  Component, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Countdown badge for a fixed seat hold. Counts down from `expiresAt` and
 * emits (expired) exactly once when the timer crosses 0. Parent decides what
 * to do on expiry (usually: kick the user back to the picker + toast).
 */
@Component({
  selector: 'app-hold-timer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    <div class="timer" [class.timer--warn]="secondsLeft <= 60" [class.timer--dead]="secondsLeft <= 0">
      <span class="timer__ic">⏱</span>
      <span class="timer__lbl" *ngIf="secondsLeft > 0">Seats held · {{ formatted }}</span>
      <span class="timer__lbl" *ngIf="secondsLeft <= 0">Hold expired</span>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .timer { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 999px; background: #eefaf2; color: #0e7a3d; font-size: 12px; font-weight: 800; }
    .timer--warn { background: #fff4e1; color: #a05a00; }
    .timer--dead { background: #fdecea; color: #c0392b; }
    .timer__ic { font-size: 13px; }
  `],
})
export class HoldTimerComponent implements OnChanges, OnDestroy {
  @Input() expiresAt: string | null = null;
  @Output() expired = new EventEmitter<void>();

  secondsLeft = 0;
  private tickHandle: ReturnType<typeof setInterval> | null = null;
  private firedExpired = false;

  constructor(private cdr: ChangeDetectorRef) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['expiresAt']) {
      this.firedExpired = false;
      this.recompute();
      this.stop();
      if (this.expiresAt) {
        this.tickHandle = setInterval(() => this.recompute(), 1000);
      }
    }
  }

  ngOnDestroy(): void { this.stop(); }

  get formatted(): string {
    const m = Math.floor(Math.max(0, this.secondsLeft) / 60);
    const s = Math.max(0, this.secondsLeft) % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  private recompute(): void {
    if (!this.expiresAt) { this.secondsLeft = 0; return; }
    const target = new Date(this.expiresAt).getTime();
    this.secondsLeft = Math.max(0, Math.floor((target - Date.now()) / 1000));
    this.cdr.markForCheck();
    if (this.secondsLeft <= 0 && !this.firedExpired) {
      this.firedExpired = true;
      this.expired.emit();
      this.stop();
    }
  }

  private stop(): void {
    if (this.tickHandle) { clearInterval(this.tickHandle); this.tickHandle = null; }
  }
}
