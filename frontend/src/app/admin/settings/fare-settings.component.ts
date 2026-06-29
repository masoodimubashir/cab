import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { CityContextService } from '../../core/city-context.service';
import { ToastService } from '../../core/toast.service';
import { ButtonComponent, IconComponent, IconName, StatusPillComponent } from '../../ui';
import { OutstationPackagesComponent } from './outstation-packages.component';
import { VehicleBasePricingComponent } from './vehicle-base-pricing.component';

type FareBucket = 'private' | 'fixed' | 'shuttle';

interface VehicleFareRow {
  id: number;
  city_id: number;
  ride_type_id: number;
  ride_type_name: string;
  display_name: string;
  max_people: number;
  luggage_capacity: number;
  is_active: boolean;
  is_outstation?: boolean;
}

interface FareBucketOption {
  key: FareBucket;
  label: string;
  icon: IconName;
  hint: string;
}

@Component({
  selector: 'app-fare-settings',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonComponent,
    IconComponent,
    StatusPillComponent,
    OutstationPackagesComponent,
    VehicleBasePricingComponent,
  ],
  template: `
    <div class="page">
      <header class="page__hero">
        <div>
          <h1 class="page__title">Fare Settings</h1>
          <p class="page__sub">City-level fare setup separated by ride type. Vehicle Details now stays for vehicle identity, capacity and images.</p>
        </div>
      </header>

      <div class="cue" *ngIf="cityId == null">
        <tm-icon name="map-marker" [size]="24" />
        <p class="cue__title">No city selected</p>
        <p class="cue__text">Pick a city from the top bar to manage fare settings.</p>
      </div>

      <ng-container *ngIf="cityId != null">
        <nav class="modes" aria-label="Fare sections">
          <button
            *ngFor="let b of buckets"
            type="button"
            class="mode"
            [class.is-active]="activeBucket === b.key"
            (click)="setBucket(b.key)"
          >
            <tm-icon [name]="b.icon" [size]="16" />
            <span class="mode__txt">
              <strong>{{ b.label }}</strong>
              <small>{{ b.hint }}</small>
            </span>
            <span class="mode__count">{{ countFor(b.key) }}</span>
          </button>
        </nav>

        <section class="layout">
          <aside class="vehicles">
            <div class="vehicles__head">
              <div>
                <h2>{{ activeBucketLabel }}</h2>
                <p>Select a vehicle to edit its fare.</p>
              </div>
              <tm-button variant="outline" size="sm" icon="refresh" [disabled]="loading" (clicked)="fetch()">
                Refresh
              </tm-button>
            </div>

            <div class="search">
              <tm-icon name="search" [size]="15" />
              <input type="text" [(ngModel)]="search" placeholder="Search vehicles" />
            </div>

            <div class="list" *ngIf="!loading && filteredRows.length">
              <button
                *ngFor="let row of filteredRows"
                type="button"
                class="vehicle"
                [class.is-selected]="selected?.id === row.id"
                (click)="select(row)"
              >
                <span class="vehicle__icon"><tm-icon name="car" [size]="15" /></span>
                <span class="vehicle__main">
                  <strong>{{ row.display_name }}</strong>
                  <small>{{ row.ride_type_name || 'Ride type not set' }} · {{ row.max_people }} seats</small>
                </span>
                <tm-status-pill [tone]="row.is_active ? 'success' : 'neutral'">
                  {{ row.is_active ? 'Active' : 'Off' }}
                </tm-status-pill>
              </button>
            </div>

            <div class="empty" *ngIf="loading">Loading vehicles...</div>
            <div class="empty" *ngIf="!loading && !filteredRows.length">
              No {{ activeBucketLabel.toLowerCase() }} vehicles found for this city.
            </div>
          </aside>

          <main class="editor">
            <div class="editor__empty" *ngIf="!selected">
              <tm-icon name="rupee" [size]="24" />
              <h2>Select a vehicle</h2>
              <p>The fare editor will open here.</p>
            </div>

            <ng-container *ngIf="selected">
              <header class="editor__head">
                <div>
                  <h2>{{ selected.display_name }}</h2>
                  <p>{{ selected.ride_type_name }} · {{ selected.max_people }} seats · {{ selected.luggage_capacity }} bags</p>
                </div>
                <tm-button variant="outline" size="sm" icon="arrow-right" (clicked)="openVehicleDetails()">
                  Vehicle details
                </tm-button>
              </header>

              <section class="notice" *ngIf="activeBucket === 'fixed'">
                <tm-icon name="road" [size]="16" />
                <span>Fixed route per-seat fare is still managed in Fixed Routes. This panel only covers vehicle-level rate cards that already existed.</span>
              </section>

              <section class="notice" *ngIf="activeBucket === 'shuttle'">
                <tm-icon name="shield" [size]="16" />
                <span>Dynamic Shuttle fare setup is prepared here. Shuttle booking remains planned until the quote and booking APIs are wired.</span>
              </section>

              <section class="fare-card" *ngIf="!isOutstation(selected)">
                <app-vehicle-base-pricing
                  [cityId]="cityId"
                  [cityVehicleTypeId]="selected.id"
                  [title]="activeBucketLabel + ' Rate Card'"
                  [subtitle]="rateCardSubtitle"
                ></app-vehicle-base-pricing>
              </section>

              <section class="fare-card" *ngIf="isOutstation(selected)">
                <app-outstation-packages [cityId]="cityId" [vehicleTypeId]="selected.id"></app-outstation-packages>
              </section>
            </ng-container>
          </main>
        </section>
      </ng-container>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .page { display: flex; flex-direction: column; gap: 16px; }
    .page__hero { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
    .page__title { margin: 0; font-size: 22px; font-weight: 800; color: var(--tm-text); }
    .page__sub { margin: 4px 0 0; font-size: 13px; color: var(--tm-text-muted); max-width: 78ch; }

    .cue, .empty, .editor__empty {
      display: flex; flex-direction: column; align-items: center; gap: 6px;
      padding: 42px 22px; text-align: center;
      background: var(--tm-surface); border: 1px dashed var(--tm-line);
      border-radius: var(--tm-radius-lg, 14px); color: var(--tm-text-muted);
    }
    .cue__title, .editor__empty h2 { margin: 6px 0 0; font-size: 15px; font-weight: 800; color: var(--tm-text); }
    .cue__text, .editor__empty p { margin: 0; font-size: 13px; }

    .modes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .mode {
      display: flex; align-items: center; gap: 10px; min-width: 0;
      padding: 12px; border: 1px solid var(--tm-line); border-radius: 10px;
      background: var(--tm-surface); color: var(--tm-text-muted); cursor: pointer;
      font-family: inherit; text-align: left;
    }
    .mode.is-active { border-color: var(--tm-green); color: var(--tm-green); background: var(--tm-green-tint, #e0f7fa); }
    .mode__txt { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
    .mode__txt strong { font-size: 13px; font-weight: 800; color: var(--tm-text); }
    .mode__txt small { font-size: 11px; color: var(--tm-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .mode__count { font-size: 11px; font-weight: 800; padding: 2px 7px; border-radius: 999px; background: var(--tm-canvas-2); color: var(--tm-text-muted); }

    .layout { display: grid; grid-template-columns: minmax(300px, 360px) minmax(0, 1fr); gap: 16px; align-items: start; }
    .vehicles, .editor, .fare-card {
      background: var(--tm-surface); border: 1px solid var(--tm-line);
      border-radius: var(--tm-radius-lg, 14px);
    }
    .vehicles { display: flex; flex-direction: column; overflow: hidden; }
    .vehicles__head, .editor__head {
      display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
      padding: 14px 16px; border-bottom: 1px solid var(--tm-line);
    }
    .vehicles__head h2, .editor__head h2 { margin: 0; font-size: 15px; font-weight: 800; color: var(--tm-text); }
    .vehicles__head p, .editor__head p { margin: 2px 0 0; font-size: 12px; color: var(--tm-text-muted); }

    .search { display: flex; align-items: center; gap: 8px; margin: 12px; padding: 0 10px; height: 36px; border: 1px solid var(--tm-line); border-radius: 8px; background: var(--tm-canvas); color: var(--tm-text-muted); }
    .search input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--tm-text); font: inherit; font-size: 13px; }

    .list { display: flex; flex-direction: column; gap: 6px; padding: 0 12px 12px; max-height: calc(100vh - 310px); overflow: auto; }
    .vehicle {
      display: flex; align-items: center; gap: 10px; width: 100%; min-height: 58px;
      padding: 10px; border: 1px solid var(--tm-line); border-radius: 10px;
      background: var(--tm-canvas); color: var(--tm-text); cursor: pointer; text-align: left; font-family: inherit;
    }
    .vehicle:hover, .vehicle.is-selected { border-color: var(--tm-green); background: var(--tm-green-tint, #e0f7fa); }
    .vehicle__icon { width: 34px; height: 34px; border-radius: 9px; flex: none; display: inline-flex; align-items: center; justify-content: center; background: var(--tm-surface); color: var(--tm-green); }
    .vehicle__main { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
    .vehicle__main strong { font-size: 13px; font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .vehicle__main small { font-size: 11px; color: var(--tm-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .editor { min-height: 420px; overflow: hidden; }
    .editor__empty { min-height: 420px; border: 0; border-radius: 0; background: transparent; }
    .fare-card { margin: 14px; padding: 16px; }
    .notice {
      display: flex; align-items: flex-start; gap: 8px;
      margin: 14px 14px 0; padding: 10px 12px;
      border: 1px solid var(--tm-line); border-radius: 9px;
      background: var(--tm-canvas); color: var(--tm-text-muted); font-size: 12px; font-weight: 600;
    }

    @media (max-width: 980px) {
      .modes { grid-template-columns: 1fr; }
      .layout { grid-template-columns: 1fr; }
      .list { max-height: none; }
    }
  `],
})
export class FareSettingsComponent implements OnInit, OnDestroy {
  cityId: number | null = null;
  rows: VehicleFareRow[] = [];
  loading = false;
  search = '';
  activeBucket: FareBucket = 'private';
  selected: VehicleFareRow | null = null;

  readonly buckets: FareBucketOption[] = [
    { key: 'private', label: 'Private Fare', icon: 'car', hint: 'Normal, local, outstation and rental fare setup' },
    { key: 'fixed', label: 'Fixed Fare', icon: 'road', hint: 'Fixed ride vehicle fare setup' },
    { key: 'shuttle', label: 'Shuttle Fare', icon: 'rupee', hint: 'Dynamic Shuttle fare setup' },
  ];

  private subs: Subscription[] = [];

  constructor(
    private api: ApiService,
    private cityCtx: CityContextService,
    private toast: ToastService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.cityCtx.ensureCitiesLoaded().subscribe();
    this.subs.push(
      this.cityCtx.cityId$.subscribe((id) => {
        this.cityId = id;
        this.selected = null;
        if (id != null) this.fetch();
        else this.rows = [];
      }),
    );
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
  }

  fetch(): void {
    if (this.cityId == null) return;
    this.loading = true;
    this.api.get<{ data: VehicleFareRow[] }>(`/admin/cities/${this.cityId}/vehicle-types`).subscribe({
      next: (res) => {
        this.rows = res.data ?? [];
        this.loading = false;
        const current = this.selected ? this.rows.find((r) => r.id === this.selected?.id) ?? null : null;
        this.selected = current ?? this.filteredRows[0] ?? null;
      },
      error: () => {
        this.loading = false;
        this.toast.error('Failed to load fare settings');
      },
    });
  }

  setBucket(bucket: FareBucket): void {
    this.activeBucket = bucket;
    this.search = '';
    this.selected = this.filteredRows[0] ?? null;
  }

  select(row: VehicleFareRow): void {
    this.selected = row;
  }

  openVehicleDetails(): void {
    if (!this.selected) return;
    this.router.navigateByUrl(`/settings/vehicle-types/${this.selected.id}`);
  }

  get filteredRows(): VehicleFareRow[] {
    const q = this.search.trim().toLowerCase();
    return this.rows
      .filter((r) => this.bucketFor(r) === this.activeBucket)
      .filter((r) => !q || r.display_name.toLowerCase().includes(q) || (r.ride_type_name ?? '').toLowerCase().includes(q));
  }

  get activeBucketLabel(): string {
    return this.buckets.find((b) => b.key === this.activeBucket)?.label ?? 'Fare';
  }

  get rateCardSubtitle(): string {
    if (this.activeBucket === 'shuttle') return 'Dynamic Shuttle fare source for this vehicle type once Shuttle booking is activated.';
    if (this.activeBucket === 'fixed') return 'Vehicle-level fare card for this fixed ride vehicle type.';
    return 'Private ride fare card for this vehicle type.';
  }

  countFor(bucket: FareBucket): number {
    return this.rows.filter((r) => this.bucketFor(r) === bucket).length;
  }

  isOutstation(row: VehicleFareRow): boolean {
    return row.is_outstation === true || (row.ride_type_name ?? '').toLowerCase().includes('outstation');
  }

  private bucketFor(row: VehicleFareRow): FareBucket {
    const name = (row.ride_type_name ?? '').toLowerCase();
    if (name.includes('shuttle')) return 'shuttle';
    if (name.includes('fixed')) return 'fixed';
    return 'private';
  }
}
