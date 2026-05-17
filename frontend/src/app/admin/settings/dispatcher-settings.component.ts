import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { CheckboxModule } from 'primeng/checkbox';
import { RadioButtonModule } from 'primeng/radiobutton';
import { AccordionModule } from 'primeng/accordion';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { CityContextService } from '../../core/city-context.service';

interface DispatcherSetting {
  id: number;
  city_id: number;
  kind: 'local' | 'rental' | 'outstation';

  automatic_dispatcher_type: boolean;
  dispatcher_hop_interval_sec: number;
  dispatcher_hop_radius_m: number;
  request_radius_m: number;
  max_hops: number;

  schedule_available: boolean;
  schedule_dispatcher_type: boolean;
  dispatch_only_assigned_scheduled: boolean;
  schedule_dispatch_instantly: 'DELAYED' | 'INSTANT' | 'INSTANT_AND_DELAYED';
  scheduler_alarm_min: number;

  schedule_current_time_diff_min: number;
  schedule_days_limit: number;
  schedule_days_limit_return: number | null;
  schedule_rides_limit: number;
  schedule_cancel_window_min: number;
}

const DISPATCH_MODES = [
  { label: 'Delayed', value: 'DELAYED' as const },
  { label: 'Instant', value: 'INSTANT' as const },
  { label: 'Instant & Delayed', value: 'INSTANT_AND_DELAYED' as const },
];

@Component({
  selector: 'app-dispatcher-settings',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardModule,
    ButtonModule,
    InputTextModule,
    InputNumberModule,
    CheckboxModule,
    RadioButtonModule,
    AccordionModule,
    ToastModule,
  ],
  providers: [MessageService],
  template: `
    <p-toast />
    <p class="muted">
      Tune the dispatch engine independently for each ride product. Changes apply per city.
    </p>

    <div *ngIf="!cityId" class="empty">Pick a city from the left rail.</div>
    <div *ngIf="cityId && loading" class="empty">Loading…</div>

    <p-accordion *ngIf="cityId && !loading" [activeIndex]="[0]" [multiple]="true">
      <p-accordionTab *ngFor="let s of settings" [header]="headerFor(s)">
        <div class="grid">
          <div class="col">
            <h4>Auto-dispatch</h4>
            <label class="row">
              <p-checkbox [(ngModel)]="forms[s.id].automatic_dispatcher_type" [binary]="true"></p-checkbox>
              Automatic dispatcher enabled
            </label>

            <label class="lbl">Hop interval (sec)</label>
            <p-inputNumber [(ngModel)]="forms[s.id].dispatcher_hop_interval_sec" [min]="1" [max]="600"></p-inputNumber>

            <label class="lbl">Hop radius (m)</label>
            <p-inputNumber [(ngModel)]="forms[s.id].dispatcher_hop_radius_m" [min]="0" [max]="50000"></p-inputNumber>

            <label class="lbl">Request radius (m)</label>
            <p-inputNumber [(ngModel)]="forms[s.id].request_radius_m" [min]="0" [max]="50000"></p-inputNumber>

            <label class="lbl">Max hops</label>
            <p-inputNumber [(ngModel)]="forms[s.id].max_hops" [min]="1" [max]="50"></p-inputNumber>
          </div>

          <div class="col">
            <h4>Scheduled rides</h4>
            <label class="row">
              <p-checkbox [(ngModel)]="forms[s.id].schedule_available" [binary]="true"></p-checkbox>
              Schedule available
            </label>
            <label class="row">
              <p-checkbox [(ngModel)]="forms[s.id].schedule_dispatcher_type" [binary]="true"></p-checkbox>
              Schedule dispatcher (auto-fire at alarm)
            </label>
            <label class="row">
              <p-checkbox [(ngModel)]="forms[s.id].dispatch_only_assigned_scheduled" [binary]="true"></p-checkbox>
              Dispatch only pre-assigned scheduled rides
            </label>

            <label class="lbl">Schedule dispatch instantly</label>
            <div class="radio-group">
              <label *ngFor="let m of dispatchModes">
                <p-radioButton
                  [name]="'mode-' + s.id"
                  [value]="m.value"
                  [(ngModel)]="forms[s.id].schedule_dispatch_instantly"
                ></p-radioButton>
                {{ m.label }}
              </label>
            </div>

            <label class="lbl">Scheduler alarm (min before pickup)</label>
            <p-inputNumber [(ngModel)]="forms[s.id].scheduler_alarm_min" [min]="0" [max]="1440"></p-inputNumber>
          </div>

          <div class="col">
            <h4>Booking window</h4>

            <label class="lbl">Min lead time (min)</label>
            <p-inputNumber [(ngModel)]="forms[s.id].schedule_current_time_diff_min" [min]="0" [max]="1440"></p-inputNumber>

            <label class="lbl">Days limit (forward)</label>
            <p-inputNumber [(ngModel)]="forms[s.id].schedule_days_limit" [min]="0" [max]="365"></p-inputNumber>

            <label class="lbl" *ngIf="s.kind === 'outstation'">Days limit (return leg)</label>
            <p-inputNumber
              *ngIf="s.kind === 'outstation'"
              [(ngModel)]="forms[s.id].schedule_days_limit_return"
              [min]="0"
              [max]="365"
            ></p-inputNumber>

            <label class="lbl">Rides limit per customer</label>
            <p-inputNumber [(ngModel)]="forms[s.id].schedule_rides_limit" [min]="0" [max]="100"></p-inputNumber>

            <label class="lbl">Cancel window (min before pickup)</label>
            <p-inputNumber [(ngModel)]="forms[s.id].schedule_cancel_window_min" [min]="0" [max]="1440"></p-inputNumber>
          </div>
        </div>

        <div class="actions">
          <button
            pButton
            type="button"
            label="Update"
            icon="pi pi-save"
            [loading]="saving[s.id] === true"
            (click)="save(s)"
          ></button>
        </div>
      </p-accordionTab>
    </p-accordion>
  `,
  styles: [
    `
      .muted { color: #64748b; font-size: 13px; margin: 0 0 12px; }
      .empty { padding: 30px; text-align: center; color: #64748b; }
      .grid {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 22px;
      }
      .col { display: flex; flex-direction: column; gap: 6px; }
      .col h4 {
        margin: 0 0 6px;
        font-size: 13px;
        font-weight: 800;
        color: #0f172a;
        letter-spacing: 0.4px;
        text-transform: uppercase;
      }
      .lbl {
        font-size: 12px;
        font-weight: 700;
        color: #475569;
        margin-top: 8px;
      }
      .row {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        font-weight: 600;
        color: #334155;
      }
      .radio-group {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .radio-group label {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        font-weight: 600;
      }
      :host ::ng-deep .p-inputnumber { width: 100%; }
      .actions {
        display: flex;
        justify-content: flex-end;
        margin-top: 16px;
      }
      @media (max-width: 1080px) {
        .grid { grid-template-columns: 1fr; }
      }
    `,
  ],
})
export class DispatcherSettingsComponent implements OnInit, OnDestroy {
  cityId: number | null = null;
  settings: DispatcherSetting[] = [];
  forms: Record<number, DispatcherSetting> = {};
  loading = false;
  saving: Record<number, boolean> = {};
  dispatchModes = DISPATCH_MODES;

  private sub?: Subscription;

  constructor(
    private api: ApiService,
    private cityCtx: CityContextService,
    private msg: MessageService,
  ) {}

  ngOnInit(): void {
    this.cityCtx.ensureCitiesLoaded().subscribe();
    this.sub = this.cityCtx.cityId$.subscribe((id) => {
      this.cityId = id;
      this.settings = [];
      this.forms = {};
      if (id != null) this.fetch();
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  fetch(): void {
    if (this.cityId == null) return;
    this.loading = true;
    this.api
      .get<{ data: DispatcherSetting[] }>(`/admin/cities/${this.cityId}/dispatcher-settings`)
      .subscribe({
        next: (res) => {
          this.settings = res.data ?? [];
          this.forms = {};
          for (const s of this.settings) {
            this.forms[s.id] = { ...s };
          }
          this.loading = false;
        },
        error: () => {
          this.loading = false;
          this.msg.add({ severity: 'error', summary: 'Failed to load dispatcher settings' });
        },
      });
  }

  headerFor(s: DispatcherSetting): string {
    const label = s.kind === 'local' ? 'Local' : s.kind === 'rental' ? 'Rental' : 'Out Station';
    const auto = this.forms[s.id]?.automatic_dispatcher_type ? 'auto' : 'manual';
    return `${label} — ${auto}`;
  }

  save(s: DispatcherSetting): void {
    if (this.cityId == null) return;
    const f = this.forms[s.id];
    if (!f) return;

    this.saving[s.id] = true;
    const payload: Partial<DispatcherSetting> = {
      automatic_dispatcher_type: f.automatic_dispatcher_type,
      dispatcher_hop_interval_sec: f.dispatcher_hop_interval_sec,
      dispatcher_hop_radius_m: f.dispatcher_hop_radius_m,
      request_radius_m: f.request_radius_m,
      max_hops: f.max_hops,

      schedule_available: f.schedule_available,
      schedule_dispatcher_type: f.schedule_dispatcher_type,
      dispatch_only_assigned_scheduled: f.dispatch_only_assigned_scheduled,
      schedule_dispatch_instantly: f.schedule_dispatch_instantly,
      scheduler_alarm_min: f.scheduler_alarm_min,

      schedule_current_time_diff_min: f.schedule_current_time_diff_min,
      schedule_days_limit: f.schedule_days_limit,
      schedule_days_limit_return: s.kind === 'outstation' ? f.schedule_days_limit_return : null,
      schedule_rides_limit: f.schedule_rides_limit,
      schedule_cancel_window_min: f.schedule_cancel_window_min,
    };

    this.api
      .patch<{ setting: DispatcherSetting }>(
        `/admin/cities/${this.cityId}/dispatcher-settings/${s.id}`,
        payload,
      )
      .subscribe({
        next: (res) => {
          this.saving[s.id] = false;
          if (res.setting) {
            const idx = this.settings.findIndex((x) => x.id === s.id);
            if (idx >= 0) this.settings[idx] = res.setting;
            this.forms[s.id] = { ...res.setting };
          }
          this.msg.add({ severity: 'success', summary: `${this.headerFor(s).split(' — ')[0]} saved` });
        },
        error: () => {
          this.saving[s.id] = false;
          this.msg.add({ severity: 'error', summary: 'Failed to save' });
        },
      });
  }
}
