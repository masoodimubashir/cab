import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TabViewModule } from 'primeng/tabview';
import { InputTextModule } from 'primeng/inputtext';
import { Subscription } from 'rxjs';
import { CityContextService, CityOption } from '../../core/city-context.service';
import { GeneralSettingsComponent } from './general-settings.component';
import { CitySettingsComponent } from './city-settings.component';
import { DispatcherSettingsComponent } from './dispatcher-settings.component';
import { VehicleTypesComponent } from './vehicle-types.component';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TabViewModule,
    InputTextModule,
    GeneralSettingsComponent,
    CitySettingsComponent,
    DispatcherSettingsComponent,
    VehicleTypesComponent,
  ],
  template: `
    <div class="settings-shell">
      <aside class="cities-rail">
        <div class="rail-head">
          <span class="rail-lbl">Cities</span>
          <input
            pInputText
            type="text"
            [(ngModel)]="filter"
            placeholder="Search city…"
            class="rail-filter"
          />
        </div>
        <ul class="cities-list">
          <li
            *ngFor="let c of filteredCities()"
            class="city-row"
            [class.active]="c.id === selectedCityId"
            (click)="select(c.id)"
          >
            <span class="city-row__dot" [class.on]="c.id === selectedCityId"></span>
            <span class="city-row__name">{{ c.name }}</span>
          </li>
          <li *ngIf="cities.length === 0" class="city-empty">No cities yet</li>
        </ul>
      </aside>

      <section class="content">
        <p-tabView [(activeIndex)]="activeIndex">
          <p-tabPanel header="General Settings">
            <app-general-settings *ngIf="activeIndex === 0"></app-general-settings>
          </p-tabPanel>
          <p-tabPanel header="City Settings">
            <app-city-settings *ngIf="activeIndex === 1"></app-city-settings>
          </p-tabPanel>
          <p-tabPanel header="Dispatcher Settings">
            <app-dispatcher-settings *ngIf="activeIndex === 2"></app-dispatcher-settings>
          </p-tabPanel>
          <p-tabPanel header="Vehicle Fare Settings">
            <app-vehicle-types *ngIf="activeIndex === 3"></app-vehicle-types>
          </p-tabPanel>
        </p-tabView>
      </section>
    </div>
  `,
  styles: [
    `
      .settings-shell {
        display: grid;
        grid-template-columns: 240px 1fr;
        gap: 18px;
        align-items: start;
      }

      .cities-rail {
        position: sticky;
        top: 16px;
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        overflow: hidden;
        max-height: calc(100vh - 32px);
        display: flex;
        flex-direction: column;
      }

      .rail-head {
        padding: 12px 12px 8px;
        border-bottom: 1px solid #e2e8f0;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .rail-lbl {
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.6px;
        text-transform: uppercase;
        color: #64748b;
      }

      .rail-filter {
        width: 100%;
        font-size: 13px;
      }

      .cities-list {
        list-style: none;
        margin: 0;
        padding: 6px;
        overflow-y: auto;
        flex: 1 1 auto;
      }

      .city-row {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 9px 10px;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 600;
        color: #334155;
        cursor: pointer;
        user-select: none;
        transition: background 0.12s ease;
      }

      .city-row:hover {
        background: #f1f5f9;
      }

      .city-row.active {
        background: #06b6d4;
        color: #ffffff;
      }

      .city-row__dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #cbd5e1;
      }

      .city-row__dot.on {
        background: #ffffff;
      }

      .city-empty {
        padding: 14px 12px;
        color: #94a3b8;
        font-size: 12px;
      }

      .content {
        min-width: 0;
      }

      :host ::ng-deep .p-tabview .p-tabview-nav {
        border-bottom: 1px solid #e2e8f0;
      }

      :host ::ng-deep .p-tabview .p-tabview-panels {
        padding: 16px 0 0;
        background: transparent;
      }

      @media (max-width: 880px) {
        .settings-shell {
          grid-template-columns: 1fr;
        }
        .cities-rail {
          position: static;
          max-height: 280px;
        }
      }
    `,
  ],
})
export class SettingsComponent implements OnInit, OnDestroy {
  cities: CityOption[] = [];
  selectedCityId: number | null = null;
  filter = '';
  activeIndex = 0;

  private subs: Subscription[] = [];

  constructor(private cityCtx: CityContextService) {}

  ngOnInit(): void {
    this.cityCtx.ensureCitiesLoaded().subscribe();
    this.subs.push(
      this.cityCtx.cities$.subscribe((list) => (this.cities = list)),
      this.cityCtx.cityId$.subscribe((id) => (this.selectedCityId = id)),
    );
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
  }

  filteredCities(): CityOption[] {
    const q = this.filter.trim().toLowerCase();
    if (!q) return this.cities;
    return this.cities.filter((c) => c.name.toLowerCase().includes(q));
  }

  select(id: number): void {
    this.cityCtx.setCityId(id);
  }
}
