import { Component, OnDestroy, OnInit } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { Subscription } from 'rxjs';
import {
  DEV_LOCATION_PRESETS,
  DevLocationOverride,
  DevLocationPreset,
  DevLocationService,
} from './dev-location.service';

@Component({
  selector: 'app-dev-location-modal',
  standalone: false,
  template: `
    <ion-header>
      <ion-toolbar color="warning">
        <ion-title>Dev Location Override</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="close()">Close</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <p class="hint">
        Forces every geolocation call in this app to return the picked coordinates.
        Only active in non-production builds. Use <strong>Use Real GPS</strong> to restore.
      </p>

      <div class="active" *ngIf="active">
        <div class="active-label">Active override</div>
        <div class="active-value">{{ active.label }}</div>
        <div class="active-coords">{{ active.lat | number: '1.4-4' }}, {{ active.lng | number: '1.4-4' }}</div>
      </div>
      <div class="active inactive" *ngIf="!active">
        <div class="active-label">No override</div>
        <div class="active-value">Using real GPS</div>
      </div>

      <h3>Presets</h3>
      <div class="preset-grid">
        <ion-button
          *ngFor="let preset of presets"
          expand="block"
          [color]="isActive(preset) ? 'success' : 'medium'"
          (click)="pick(preset)"
        >
          {{ preset.label }}
        </ion-button>
      </div>

      <h3>Custom</h3>
      <ion-item>
        <ion-label position="stacked">Latitude</ion-label>
        <ion-input type="number" [(ngModel)]="customLat" placeholder="34.3064"></ion-input>
      </ion-item>
      <ion-item>
        <ion-label position="stacked">Longitude</ion-label>
        <ion-input type="number" [(ngModel)]="customLng" placeholder="74.4502"></ion-input>
      </ion-item>
      <ion-item>
        <ion-label position="stacked">Label (optional)</ion-label>
        <ion-input type="text" [(ngModel)]="customLabel" placeholder="My test spot"></ion-input>
      </ion-item>
      <ion-button expand="block" color="primary" (click)="applyCustom()" [disabled]="!canApplyCustom()">
        Apply Custom
      </ion-button>

      <div class="footer-actions">
        <ion-button expand="block" color="danger" fill="outline" (click)="clear()">
          Use Real GPS (Clear Override)
        </ion-button>
        <ion-button expand="block" color="tertiary" fill="outline" (click)="reload()">
          Reload App
        </ion-button>
      </div>
    </ion-content>
  `,
  styles: [
    `
      .hint {
        font-size: 13px;
        color: var(--ion-color-medium);
        margin-bottom: 16px;
      }
      .active {
        background: var(--ion-color-success-tint);
        color: var(--ion-color-success-contrast);
        padding: 12px 16px;
        border-radius: 8px;
        margin-bottom: 20px;
      }
      .active.inactive {
        background: var(--ion-color-light);
        color: var(--ion-color-medium-shade);
      }
      .active-label {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        opacity: 0.85;
      }
      .active-value {
        font-size: 18px;
        font-weight: 600;
        margin-top: 2px;
      }
      .active-coords {
        font-family: monospace;
        font-size: 12px;
        margin-top: 2px;
        opacity: 0.85;
      }
      h3 {
        margin-top: 24px;
        margin-bottom: 8px;
        font-size: 15px;
      }
      .preset-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }
      .preset-grid ion-button {
        margin: 0;
      }
      .footer-actions {
        margin-top: 24px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
    `,
  ],
})
export class DevLocationModalComponent implements OnInit, OnDestroy {
  presets: DevLocationPreset[] = DEV_LOCATION_PRESETS;
  active: DevLocationOverride | null = null;
  customLat: number | null = null;
  customLng: number | null = null;
  customLabel = '';

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

  isActive(preset: DevLocationPreset): boolean {
    return !!this.active && this.active.lat === preset.lat && this.active.lng === preset.lng;
  }

  pick(preset: DevLocationPreset): void {
    this.dev.set({ lat: preset.lat, lng: preset.lng, label: preset.label });
  }

  canApplyCustom(): boolean {
    return (
      typeof this.customLat === 'number' &&
      typeof this.customLng === 'number' &&
      Number.isFinite(this.customLat) &&
      Number.isFinite(this.customLng)
    );
  }

  applyCustom(): void {
    if (!this.canApplyCustom()) return;
    this.dev.set({
      lat: this.customLat as number,
      lng: this.customLng as number,
      label: this.customLabel?.trim() || 'Custom',
    });
  }

  clear(): void {
    this.dev.clear();
  }

  reload(): void {
    window.location.reload();
  }

  close(): void {
    void this.modalCtrl.dismiss();
  }
}
