import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { CityContextService } from '../../core/city-context.service';
import { ToastService } from '../../core/toast.service';
import { ButtonComponent, IconComponent } from '../../ui';

interface DispatcherSetting {
  id: number;
  city_id: number;
  kind: 'local' | 'outstation';

  automatic_dispatcher_type: boolean;
  dispatcher_hop_interval_sec: number;
  dispatcher_hop_radius_m: number;
  request_radius_m: number;
  max_hops: number;
  driver_accept_window_sec: number;

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

/**
 * Dispatcher Settings — dispatch-engine tuning per ride product for the city
 * chosen in the topbar switcher. A segmented selector switches between the
 * Local / Rental / Outstation product; each saves on its own.
 */
@Component({
  selector: 'app-dispatcher-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent, IconComponent],
  template: `
    <p class="intro">Tune the dispatch engine independently for each ride product.</p>

    <div class="cue" *ngIf="!cityId">
      <tm-icon name="map-marker" [size]="24" />
      <p class="cue__title">No city selected</p>
      <p class="cue__text">Pick a city from the switcher in the top bar.</p>
    </div>

    <div class="cue" *ngIf="cityId && loading">
      <tm-icon name="refresh" [size]="20" /><p class="cue__text">Loading dispatcher settings…</p>
    </div>

    <ng-container *ngIf="cityId && !loading && active">
      <!-- kind selector -->
      <div class="seg">
        <button
          *ngFor="let s of settings"
          type="button"
          class="seg__btn"
          [class.is-on]="activeId === s.id"
          (click)="activeId = s.id"
        >
          <tm-icon [name]="kindIcon(s.kind)" [size]="14" />
          {{ kindLabel(s.kind) }}
        </button>
      </div>

      <!-- Auto-dispatch -->
      <section class="sec">
        <header class="sec__head">
          <span class="sec__icon"><tm-icon name="send" [size]="16" /></span>
          <div>
            <h3 class="sec__title">Auto-dispatch</h3>
            <p class="sec__desc">How requests are radiated out to nearby drivers.</p>
          </div>
        </header>
        <div class="sec__body">
          <label class="tgl">
            <input type="checkbox" [(ngModel)]="active.automatic_dispatcher_type" />
            <span class="tgl__track"></span>
            <span class="tgl__meta">
              <span class="tgl__label">Automatic dispatcher</span>
              <span class="tgl__hint">Auto-assign rides without a manual dispatcher.</span>
            </span>
          </label>
          <div class="grid grid-4">
            <label class="field">
              <span class="field__lbl">Hop interval (sec)</span>
              <input type="number" min="1" max="600" [(ngModel)]="active.dispatcher_hop_interval_sec" />
            </label>
            <label class="field">
              <span class="field__lbl">Hop radius (m)</span>
              <input type="number" min="0" max="50000" [(ngModel)]="active.dispatcher_hop_radius_m" />
            </label>
            <label class="field">
              <span class="field__lbl">Request radius (m)</span>
              <input type="number" min="0" max="50000" [(ngModel)]="active.request_radius_m" />
            </label>
            <label class="field">
              <span class="field__lbl">Max hops</span>
              <input type="number" min="1" max="50" [(ngModel)]="active.max_hops" />
            </label>
            <label class="field">
              <span class="field__lbl">Driver accept window (sec)</span>
              <input type="number" min="0" max="600" [(ngModel)]="active.driver_accept_window_sec" />
            </label>
          </div>
          <p class="hint">A pinged driver must accept within this many seconds (0 = no limit).</p>
        </div>
      </section>

      <!-- Scheduled rides -->
      <section class="sec">
        <header class="sec__head">
          <span class="sec__icon"><tm-icon name="calendar" [size]="16" /></span>
          <div>
            <h3 class="sec__title">Scheduled rides</h3>
            <p class="sec__desc">Behaviour for rides booked in advance.</p>
          </div>
        </header>
        <div class="sec__body">
          <div class="toggles">
            <label class="tgl">
              <input type="checkbox" [(ngModel)]="active.schedule_available" />
              <span class="tgl__track"></span>
              <span class="tgl__meta"><span class="tgl__label">Scheduling available</span></span>
            </label>
            <label class="tgl">
              <input type="checkbox" [(ngModel)]="active.schedule_dispatcher_type" />
              <span class="tgl__track"></span>
              <span class="tgl__meta"><span class="tgl__label">Auto-fire at alarm time</span></span>
            </label>
            <label class="tgl">
              <input type="checkbox" [(ngModel)]="active.dispatch_only_assigned_scheduled" />
              <span class="tgl__track"></span>
              <span class="tgl__meta"><span class="tgl__label">Dispatch only pre-assigned</span></span>
            </label>
          </div>

          <div class="field">
            <span class="field__lbl">Schedule dispatch mode</span>
            <div class="chips">
              <button
                *ngFor="let m of dispatchModes"
                type="button"
                class="chip"
                [class.is-on]="active.schedule_dispatch_instantly === m.value"
                (click)="active.schedule_dispatch_instantly = m.value"
              >{{ m.label }}</button>
            </div>
          </div>

          <label class="field field--narrow">
            <span class="field__lbl">Scheduler alarm (min before pickup)</span>
            <input type="number" min="0" max="1440" [(ngModel)]="active.scheduler_alarm_min" />
          </label>
        </div>
      </section>

      <!-- Booking window -->
      <section class="sec">
        <header class="sec__head">
          <span class="sec__icon"><tm-icon name="refresh" [size]="16" /></span>
          <div>
            <h3 class="sec__title">Booking window</h3>
            <p class="sec__desc">Limits on how far ahead riders can schedule.</p>
          </div>
        </header>
        <div class="sec__body">
          <div class="grid grid-4">
            <label class="field">
              <span class="field__lbl">Min lead time (min)</span>
              <input type="number" min="0" max="1440" [(ngModel)]="active.schedule_current_time_diff_min" />
            </label>
            <label class="field">
              <span class="field__lbl">Days limit (forward)</span>
              <input type="number" min="0" max="365" [(ngModel)]="active.schedule_days_limit" />
            </label>
            <label class="field" *ngIf="active.kind === 'outstation'">
              <span class="field__lbl">Days limit (return leg)</span>
              <input type="number" min="0" max="365" [(ngModel)]="active.schedule_days_limit_return" />
            </label>
            <label class="field">
              <span class="field__lbl">Rides limit / customer</span>
              <input type="number" min="0" max="100" [(ngModel)]="active.schedule_rides_limit" />
            </label>
            <label class="field">
              <span class="field__lbl">Cancel window (min)</span>
              <input type="number" min="0" max="1440" [(ngModel)]="active.schedule_cancel_window_min" />
            </label>
          </div>
        </div>
      </section>

      <div class="savebar">
        <span class="savebar__hint">{{ kindLabel(active.kind) }} dispatcher · this city only.</span>
        <tm-button variant="green" icon="check" [disabled]="saving" (clicked)="save()">
          {{ saving ? 'Saving…' : 'Save ' + kindLabel(active.kind) }}
        </tm-button>
      </div>
    </ng-container>
  `,
  styles: [`
    .intro { margin: 0 0 14px; font-size: 13px; color: var(--tm-text-muted); }

    .cue {
      display: flex; flex-direction: column; align-items: center; gap: 6px;
      padding: 48px 24px; text-align: center;
      background: var(--tm-surface); border: 1px dashed var(--tm-line);
      border-radius: var(--tm-radius-lg); color: var(--tm-text-muted);
    }
    .cue__title { margin: 6px 0 0; font-size: 15px; font-weight: 800; color: var(--tm-text); }
    .cue__text { margin: 0; font-size: 13px; }

    .seg {
      display: inline-flex; gap: 4px; padding: 4px; margin-bottom: 14px;
      background: var(--tm-canvas-2); border-radius: var(--tm-radius-md, 10px);
    }
    .seg__btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 8px 15px; border-radius: 8px;
      font-size: 13px; font-weight: 700; color: var(--tm-text-muted);
      background: transparent; cursor: pointer;
    }
    .seg__btn.is-on { background: var(--tm-surface); color: var(--tm-text); box-shadow: var(--tm-shadow-sm); }

    .sec {
      background: var(--tm-surface); border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-lg, 14px); overflow: hidden;
      margin-bottom: 14px;
    }
    .sec__head {
      display: flex; align-items: center; gap: 11px;
      padding: 14px 16px; border-bottom: 1px solid var(--tm-line);
    }
    .sec__icon {
      width: 34px; height: 34px; border-radius: 9px; flex: none;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--tm-green-tint, #e0f7fa); color: var(--tm-green);
    }
    .sec__title { margin: 0; font-size: 14px; font-weight: 800; color: var(--tm-text); }
    .sec__desc { margin: 1px 0 0; font-size: 12px; color: var(--tm-text-muted); }
    .sec__body { padding: 16px; display: flex; flex-direction: column; gap: 14px; }

    .grid { display: grid; gap: 14px; }
    .grid-4 { grid-template-columns: repeat(4, 1fr); }

    .field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
    .field--narrow { max-width: 280px; }
    .field__lbl { font-size: 12px; font-weight: 700; color: var(--tm-text); }
    .field input {
      width: 100%; padding: 9px 11px;
      border: 1px solid var(--tm-line); border-radius: 9px;
      background: var(--tm-canvas); color: var(--tm-text);
      font-size: 13px; outline: none;
    }
    .field input:focus { border-color: var(--tm-green); }
    .hint { margin: 2px 0 0; font-size: 11px; color: var(--tm-text-muted); }

    .toggles { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
    .tgl { display: flex; align-items: flex-start; gap: 10px; cursor: pointer; }
    .tgl input { display: none; }
    .tgl__track {
      flex: none; margin-top: 1px;
      width: 38px; height: 22px; border-radius: 999px;
      background: var(--tm-line); position: relative;
      transition: background var(--tm-duration-fast) var(--tm-ease);
    }
    .tgl__track::after {
      content: ''; position: absolute; top: 2px; left: 2px;
      width: 18px; height: 18px; border-radius: 50%;
      background: #fff; box-shadow: var(--tm-shadow-sm);
      transition: transform var(--tm-duration-fast) var(--tm-ease);
    }
    .tgl input:checked + .tgl__track { background: var(--tm-green); }
    .tgl input:checked + .tgl__track::after { transform: translateX(16px); }
    .tgl__meta { display: flex; flex-direction: column; }
    .tgl__label { font-size: 13px; font-weight: 700; color: var(--tm-text); }
    .tgl__hint { font-size: 11px; color: var(--tm-text-muted); }

    .chips { display: flex; gap: 8px; flex-wrap: wrap; }
    .chip {
      padding: 8px 14px; border-radius: 999px;
      border: 1px solid var(--tm-line); background: var(--tm-canvas);
      color: var(--tm-text-muted); font-size: 13px; font-weight: 700; cursor: pointer;
    }
    .chip.is-on { background: var(--tm-green-tint, #e0f7fa); border-color: var(--tm-green); color: var(--tm-green); }

    .savebar {
      position: sticky; bottom: 0;
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: 12px 16px;
      background: var(--tm-surface); border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-lg, 14px); box-shadow: var(--tm-shadow-pop);
    }
    .savebar__hint { font-size: 12px; color: var(--tm-text-muted); }

    @media (max-width: 900px) {
      .grid-4 { grid-template-columns: 1fr 1fr; }
      .toggles { grid-template-columns: 1fr; }
    }
    @media (max-width: 560px) { .grid-4 { grid-template-columns: 1fr; } }
  `],
})
export class DispatcherSettingsComponent implements OnInit, OnDestroy {
  cityId: number | null = null;
  settings: DispatcherSetting[] = [];
  activeId: number | null = null;
  loading = false;
  saving = false;
  dispatchModes = DISPATCH_MODES;

  private sub?: Subscription;

  constructor(
    private api: ApiService,
    private cityCtx: CityContextService,
    private toast: ToastService,
  ) {}

  ngOnInit(): void {
    this.cityCtx.ensureCitiesLoaded().subscribe();
    this.sub = this.cityCtx.cityId$.subscribe((id) => {
      this.cityId = id;
      this.settings = [];
      this.activeId = null;
      if (id != null) this.fetch();
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  get active(): DispatcherSetting | null {
    return this.settings.find((s) => s.id === this.activeId) ?? null;
  }

  kindLabel(k: string): string {
    return k === 'outstation' ? 'Outstation' : 'Local';
  }

  kindIcon(k: string): 'car' | 'road' {
    return k === 'outstation' ? 'road' : 'car';
  }

  fetch(): void {
    if (this.cityId == null) return;
    this.loading = true;
    this.api
      .get<{ data: DispatcherSetting[] }>(`/admin/cities/${this.cityId}/dispatcher-settings`)
      .subscribe({
        next: (res) => {
          this.settings = (res.data ?? []).map((s) => ({ ...s }));
          this.activeId = this.settings[0]?.id ?? null;
          this.loading = false;
        },
        error: () => {
          this.loading = false;
          this.toast.error('Failed to load dispatcher settings');
        },
      });
  }

  save(): void {
    const f = this.active;
    if (this.cityId == null || !f || this.saving) return;
    this.saving = true;
    const payload: Partial<DispatcherSetting> = {
      automatic_dispatcher_type: f.automatic_dispatcher_type,
      dispatcher_hop_interval_sec: f.dispatcher_hop_interval_sec,
      dispatcher_hop_radius_m: f.dispatcher_hop_radius_m,
      request_radius_m: f.request_radius_m,
      max_hops: f.max_hops,
      driver_accept_window_sec: f.driver_accept_window_sec,
      schedule_available: f.schedule_available,
      schedule_dispatcher_type: f.schedule_dispatcher_type,
      dispatch_only_assigned_scheduled: f.dispatch_only_assigned_scheduled,
      schedule_dispatch_instantly: f.schedule_dispatch_instantly,
      scheduler_alarm_min: f.scheduler_alarm_min,
      schedule_current_time_diff_min: f.schedule_current_time_diff_min,
      schedule_days_limit: f.schedule_days_limit,
      schedule_days_limit_return: f.kind === 'outstation' ? f.schedule_days_limit_return : null,
      schedule_rides_limit: f.schedule_rides_limit,
      schedule_cancel_window_min: f.schedule_cancel_window_min,
    };

    this.api
      .patch<{ setting: DispatcherSetting }>(
        `/admin/cities/${this.cityId}/dispatcher-settings/${f.id}`,
        payload,
      )
      .subscribe({
        next: (res) => {
          this.saving = false;
          if (res.setting) {
            const idx = this.settings.findIndex((x) => x.id === f.id);
            if (idx >= 0) this.settings[idx] = { ...res.setting };
          }
          this.toast.success(`${this.kindLabel(f.kind)} dispatcher saved`);
        },
        error: () => {
          this.saving = false;
          this.toast.error('Failed to save dispatcher settings');
        },
      });
  }
}
