import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonComponent, IconComponent } from '../../../ui';

import { DriverProfile, VehicleForm } from './driver-detail.types';

@Component({
  selector: 'app-driver-profile-pane',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, ButtonComponent, IconComponent],
  template: `
    <header class="head" *ngIf="driver">
      <span
        class="head__avatar"
        [class.head__avatar--photo]="driver.avatar_url || driver.avatar_path"
        [style.backgroundImage]="(driver.avatar_url || driver.avatar_path) ? 'url(' + (driver.avatar_url || driver.avatar_path) + ')' : null"
      >
        <ng-container *ngIf="!(driver.avatar_url || driver.avatar_path)">{{ initials(driver.name) }}</ng-container>
      </span>
      <div class="head__title">
        <div class="head__name">
          {{ driver.name || 'Unnamed driver' }}
          <span class="muted small">#{{ driver.id }}</span>
        </div>
        <div class="head__meta">
          <span class="chip-mute">{{ driver.phone || '—' }}</span>
          <span class="chip-mute" *ngIf="driver.ride_type_name">{{ driver.ride_type_name }}</span>
          <span class="chip-mute" *ngIf="driver.vehicle_type_name">{{ driver.vehicle_type_name }}</span>
          <span class="status-pill"
                [class.is-approved]="driver.approval_status === 'approved'"
                [class.is-rejected]="driver.approval_status === 'rejected'"
                [class.is-pending]="driver.approval_status === 'pending'">
            {{ driver.approval_status }}
          </span>
          <span class="status-pill"
                [class.is-online]="driver.is_online"
                [class.is-offline]="!driver.is_online">
            <span class="status-dot"></span>
            {{ driver.is_online ? 'Online' : 'Offline' }}
          </span>
        </div>
      </div>
    </header>

    <section class="card" *ngIf="driver">
      <header class="card__head">
        <h3 class="card__title">
          <tm-icon name="car" [size]="16" />
          Vehicle
        </h3>
        <p class="card__hint">
          The driver app doesn't collect the registration number — set it here.
        </p>
      </header>
      <div class="grid two">
        <div class="field">
          <label class="lbl" for="reg-no">Registration No</label>
          <input
            id="reg-no"
            class="input"
            type="text"
            placeholder="e.g. KA01AB1234"
            [ngModel]="vehicleForm.vehicle_reg_no"
            (ngModelChange)="onRegNoChange($event)"
          />
        </div>
        <div class="field">
          <label class="lbl">Ride Type</label>
          <div class="ro-value">{{ driver.ride_type_name || '—' }}</div>
        </div>
        <div class="field">
          <label class="lbl">Vehicle Type</label>
          <div class="ro-value">{{ driver.vehicle_type_name || '—' }}</div>
        </div>
        <div class="field">
          <label class="lbl">Car</label>
          <div class="ro-value">{{ driver.city_vehicle_type_name || '—' }}</div>
        </div>
        <div class="field">
          <label class="lbl">Model</label>
          <div class="ro-value">{{ driver.vehicle_model || '—' }}</div>
        </div>
        <div class="field">
          <label class="lbl">Color</label>
          <div class="ro-value">{{ driver.vehicle_color || '—' }}</div>
        </div>
      </div>
      <div class="row-right">
        <tm-button
          variant="ink"
          size="sm"
          icon="check"
          [loading]="savingVehicle"
          (clicked)="save.emit()"
        >
          Save Reg No
        </tm-button>
      </div>
    </section>
  `,
  styles: [`
    :host { display: block; }

    .head {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: var(--tm-space-4);
    }
    .head__avatar {
      width: 44px; height: 44px;
      border-radius: 50%;
      display: grid; place-items: center;
      background: linear-gradient(135deg, var(--tm-ink), var(--tm-ink-3));
      color: #fff;
      font-size: 14px;
      font-weight: 800;
      flex-shrink: 0;
    }
    .head__avatar--photo {
      background-color: var(--tm-canvas-2);
      background-size: cover;
      background-position: center;
      background-repeat: no-repeat;
    }
    .head__title { min-width: 0; flex: 1; }
    .head__name {
      font-size: 18px;
      font-weight: 800;
      color: var(--tm-text);
      letter-spacing: -0.01em;
    }
    .head__meta {
      display: inline-flex;
      gap: 6px;
      align-items: center;
      flex-wrap: wrap;
      margin-top: 4px;
    }

    .chip-mute {
      font-size: 11px;
      font-weight: 700;
      background: var(--tm-canvas-2);
      color: var(--tm-text-muted);
      padding: 3px 10px;
      border-radius: var(--tm-radius-pill);
      text-transform: uppercase;
      letter-spacing: 0.4px;
    }
    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 10px;
      border-radius: var(--tm-radius-pill);
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      border: 1px solid transparent;
    }
    .status-pill .status-dot {
      width: 6px; height: 6px;
      border-radius: 50%;
      background: currentColor;
    }
    .status-pill.is-online      { background: var(--tm-green-tint); color: var(--tm-green-deep); border-color: var(--tm-green-soft); }
    .status-pill.is-offline     { background: var(--tm-surface);    color: var(--tm-text-muted); border-color: var(--tm-line-2); }
    .status-pill.is-approved    { background: var(--tm-green-tint); color: var(--tm-green-deep); border-color: var(--tm-green-soft); }
    .status-pill.is-rejected    { background: #fef2f2;              color: #dc2626;              border-color: #fecaca; }
    .status-pill.is-pending     { background: #fffbeb;              color: #b45309;              border-color: #fde68a; }

    .muted { color: var(--tm-text-muted); }
    .small { font-size: 12px; }

    /* Card */
    .card {
      background: var(--tm-surface);
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-md);
      padding: var(--tm-space-4);
      margin-bottom: var(--tm-space-3);
    }
    .card__head { margin-bottom: var(--tm-space-3); }
    .card__title {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin: 0 0 4px;
      font-size: 13px;
      font-weight: 800;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--tm-text);
    }
    .card__title tm-icon { color: var(--tm-green-deep); }
    .card__hint {
      margin: 0;
      font-size: 12px;
      color: var(--tm-text-muted);
    }

    .grid { display: grid; gap: 14px; }
    .grid.two { grid-template-columns: 1fr 1fr; }
    .field { display: flex; flex-direction: column; gap: 4px; }
    .lbl { font-size: 11px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: var(--tm-text-muted); }
    .ro-value {
      padding: 9px 12px;
      background: var(--tm-canvas);
      border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-sm);
      font-size: 13px;
      color: var(--tm-text-muted);
    }
    .input {
      width: 100%;
      padding: 9px 12px;
      background: var(--tm-surface);
      border: 1px solid var(--tm-line-2);
      border-radius: var(--tm-radius-sm);
      font-family: var(--tm-font-body);
      font-size: 13px;
      color: var(--tm-text);
      outline: 0;
      transition: border-color var(--tm-duration-fast) var(--tm-ease);
    }
    .input:focus { border-color: var(--tm-ink); }
    .row-right { display: flex; justify-content: flex-end; margin-top: var(--tm-space-3); }

    @media (max-width: 720px) {
      .grid.two { grid-template-columns: 1fr; }
    }
  `],
})
export class DriverProfilePaneComponent {
  @Input() driver: DriverProfile | null = null;
  @Input() vehicleForm: VehicleForm = { vehicle_reg_no: '' };
  @Input() savingVehicle = false;
  @Output() vehicleFormChange = new EventEmitter<VehicleForm>();
  @Output() save = new EventEmitter<void>();

  onRegNoChange(value: string): void {
    this.vehicleFormChange.emit({ ...this.vehicleForm, vehicle_reg_no: value });
  }

  initials(name: string | null | undefined): string {
    if (!name) return '—';
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '—';
    const a = parts[0][0] || '';
    const b = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (a + b).toUpperCase();
  }
}
