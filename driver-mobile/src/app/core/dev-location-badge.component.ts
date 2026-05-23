import { Component, OnDestroy, OnInit } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { DevLocationModalComponent } from './dev-location-modal.component';
import { DevLocationOverride, DevLocationService } from './dev-location.service';

/**
 * Floating badge that opens the dev location modal. Rendered only in
 * non-production builds (gated by *ngIf in app.component.html, defence in
 * depth with DevLocationService.isEnabled() short-circuiting on prod too).
 */
@Component({
  selector: 'app-dev-location-badge',
  standalone: false,
  template: `
    <button class="dev-badge" (click)="open()" [class.active]="!!active">
      <span class="pin">📍</span>
      <span class="label">{{ active ? active.label : 'DEV' }}</span>
    </button>
  `,
  styles: [
    `
      .dev-badge {
        position: fixed;
        bottom: 14px;
        right: 14px;
        z-index: 99999;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 12px;
        border-radius: 999px;
        background: rgba(0, 0, 0, 0.78);
        color: #fff;
        font-size: 12px;
        font-weight: 600;
        border: 1px solid rgba(255, 255, 255, 0.2);
        box-shadow: 0 4px 10px rgba(0, 0, 0, 0.25);
        cursor: pointer;
        font-family: inherit;
      }
      .dev-badge.active {
        background: var(--ion-color-success, #2dd36f);
        border-color: rgba(255, 255, 255, 0.4);
      }
      .pin {
        font-size: 14px;
      }
      .label {
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
    `,
  ],
})
export class DevLocationBadgeComponent implements OnInit, OnDestroy {
  active: DevLocationOverride | null = null;
  private sub?: Subscription;

  constructor(
    private dev: DevLocationService,
    private modalCtrl: ModalController,
  ) {}

  ngOnInit(): void {
    this.sub = this.dev.changes().subscribe((o) => (this.active = o));
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  async open(): Promise<void> {
    const modal = await this.modalCtrl.create({ component: DevLocationModalComponent });
    await modal.present();
  }
}
