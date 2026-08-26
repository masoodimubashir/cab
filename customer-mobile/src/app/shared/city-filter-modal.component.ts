import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { City } from '../pages/booking/booking.models';

@Component({
  selector: 'app-city-filter-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, IonicModule],
  template: `
    <div class="cfm" *ngIf="open" (click)="onBackdrop($event)">
      <div class="cfm__sheet" (click)="$event.stopPropagation()">
        <!-- Handle bar -->
        <div class="cfm__grip" (click)="dismiss.emit()"></div>

        <!-- Header -->
        <div class="cfm__head">
          <div class="cfm__head-text">
            <h2 class="cfm__title">Choose City</h2>
            <p class="cfm__sub">Showing fixed routes available in:</p>
          </div>
          <button type="button" class="cfm__close dc-press" (click)="dismiss.emit()" aria-label="Close">
            <ion-icon name="close-outline"></ion-icon>
          </button>
        </div>

        <!-- City Search (if > 4 cities) -->
        <div class="cfm__search" *ngIf="cities.length > 4">
          <ion-icon name="search-outline"></ion-icon>
          <input
            type="search"
            [(ngModel)]="search"
            placeholder="Search city by name..."
            autocomplete="off"
          />
          <button
            type="button"
            class="cfm__search-clear"
            *ngIf="search"
            (click)="search = ''"
            aria-label="Clear search"
          >
            <ion-icon name="close-circle"></ion-icon>
          </button>
        </div>

        <!-- City List (Scrollable within 70% height) -->
        <div class="cfm__body">
          <!-- All Cities Option -->
          <button
            type="button"
            class="cfm__item dc-press"
            [class.is-selected]="selectedCityId == null || selectedCityId === 0"
            (click)="pick(null)"
          >
            <div class="cfm__item-icon cfm__item-icon--all">
              <ion-icon name="globe-outline"></ion-icon>
            </div>
            <div class="cfm__item-main">
              <span class="cfm__item-name">All Cities</span>
              <span class="cfm__item-detail">Show all fixed routes without city filter</span>
            </div>
            <div class="cfm__item-check" *ngIf="selectedCityId == null || selectedCityId === 0">
              <ion-icon name="checkmark-circle"></ion-icon>
            </div>
          </button>

          <!-- Specific Cities -->
          <button
            type="button"
            class="cfm__item dc-press"
            *ngFor="let c of visibleCities; trackBy: trackByCity"
            [class.is-selected]="selectedCityId === c.id"
            (click)="pick(c.id)"
          >
            <div class="cfm__item-icon">
              <ion-icon name="location-sharp"></ion-icon>
            </div>
            <div class="cfm__item-main">
              <div class="cfm__item-row">
                <span class="cfm__item-name">{{ c.name }}</span>
                <span class="cfm__item-gps-badge" *ngIf="userLocationCityId === c.id">
                  Current City
                </span>
              </div>
              <span class="cfm__item-detail" *ngIf="userLocationCityId === c.id">
                Detected near your live GPS position
              </span>
            </div>
            <div class="cfm__item-check" *ngIf="selectedCityId === c.id">
              <ion-icon name="checkmark-circle"></ion-icon>
            </div>
          </button>

          <div class="cfm__empty" *ngIf="!visibleCities.length && search">
            <ion-icon name="search-outline"></ion-icon>
            <p>No city matches "<b>{{ search }}</b>"</p>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: contents;
    }

    .cfm {
      position: fixed;
      inset: 0;
      z-index: 100000;
      display: flex;
      align-items: flex-end;
      background: rgba(13, 27, 42, 0.45);
      backdrop-filter: blur(2px);
      animation: cfm-fade 0.22s ease-out;
    }

    @keyframes cfm-fade {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .cfm__sheet {
      width: 100% !important;
      height: 70vh !important;
      max-height: 70vh !important;
      background: var(--dc-surface, #FFFFFF);
      border-radius: 26px 26px 0 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      box-shadow: 0 -10px 40px rgba(13, 27, 42, 0.25);
      animation: cfm-up 0.28s cubic-bezier(0.16, 1, 0.3, 1);
      padding-bottom: calc(14px + env(safe-area-inset-bottom));
    }

    @keyframes cfm-up {
      from {
        transform: translateY(100%);
      }
      to {
        transform: translateY(0);
      }
    }

    .cfm__grip {
      width: 44px;
      height: 5px;
      border-radius: 999px;
      background: var(--dc-hairline-strong, #CBD5E1);
      margin: 10px auto 4px;
      flex-shrink: 0;
      cursor: pointer;
    }

    .cfm__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 20px 12px;
      border-bottom: 1px solid var(--dc-hairline, #F1F5F9);
      flex-shrink: 0;
    }

    .cfm__head-text {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .cfm__title {
      margin: 0;
      font-size: 19px;
      font-weight: 800;
      color: var(--dc-ink, #0D1B2A);
      letter-spacing: -0.2px;
    }

    .cfm__sub {
      margin: 0;
      font-size: 12.5px;
      color: var(--dc-ink-soft, #64748B);
      font-weight: 600;
    }

    .cfm__close {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: var(--dc-surface-subtle, #F1F5F9);
      border: none;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--dc-ink, #0D1B2A);
      font-size: 20px;
      cursor: pointer;
      flex-shrink: 0;

      &:active {
        background: #E2E8F0;
      }
    }

    .cfm__search {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 12px 18px 6px;
      padding: 8px 14px;
      background: var(--dc-surface-subtle, #F1F5F9);
      border: 1px solid var(--dc-hairline-strong, #E2E8F0);
      border-radius: 12px;
      flex-shrink: 0;

      ion-icon {
        font-size: 18px;
        color: var(--dc-ink-soft, #64748B);
        flex-shrink: 0;
      }

      input {
        flex: 1;
        border: none;
        background: transparent;
        font-size: 14px;
        font-weight: 600;
        color: var(--dc-ink, #0D1B2A);
        outline: none;

        &::placeholder {
          color: var(--dc-ink-faint, #94A3B8);
          font-weight: 500;
        }
      }

      .cfm__search-clear {
        background: none;
        border: none;
        padding: 0;
        color: var(--dc-ink-soft, #64748B);
        font-size: 16px;
        cursor: pointer;
        display: flex;
        align-items: center;
      }
    }

    .cfm__body {
      flex: 1;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      padding: 8px 16px 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .cfm__item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 13px 14px;
      background: var(--dc-surface, #FFFFFF);
      border: 1.5px solid var(--dc-hairline, #F1F5F9);
      border-radius: 16px;
      text-align: left;
      cursor: pointer;
      transition: all 0.15s ease;

      &:active {
        background: var(--dc-surface-subtle, #F8FAFC);
        transform: scale(0.99);
      }

      &.is-selected {
        border-color: var(--dc-green, #12B35B);
        background: rgba(18, 179, 91, 0.05);
      }
    }

    .cfm__item-icon {
      width: 38px;
      height: 38px;
      border-radius: 12px;
      background: rgba(18, 179, 91, 0.1);
      color: var(--dc-green, #12B35B);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      flex-shrink: 0;

      &--all {
        background: rgba(37, 99, 235, 0.1);
        color: #2563EB;
      }
    }

    .cfm__item-main {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .cfm__item-row {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .cfm__item-name {
      font-size: 15px;
      font-weight: 750;
      color: var(--dc-ink, #0D1B2A);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .cfm__item-gps-badge {
      font-size: 10.5px;
      font-weight: 800;
      color: var(--dc-green, #12B35B);
      background: rgba(18, 179, 91, 0.12);
      padding: 2px 7px;
      border-radius: 999px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    .cfm__item-detail {
      font-size: 12px;
      color: var(--dc-ink-soft, #64748B);
      font-weight: 500;
    }

    .cfm__item-check {
      font-size: 24px;
      color: var(--dc-green, #12B35B);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      animation: cfm-check-pop 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    }

    @keyframes cfm-check-pop {
      0% { transform: scale(0.6); opacity: 0; }
      100% { transform: scale(1); opacity: 1; }
    }

    .cfm__empty {
      padding: 30px 16px;
      text-align: center;
      color: var(--dc-ink-soft, #64748B);

      ion-icon {
        font-size: 32px;
        margin-bottom: 8px;
        opacity: 0.6;
      }

      p {
        margin: 0;
        font-size: 13.5px;
      }
    }
  `],
})
export class CityFilterModalComponent {
  @Input() open = false;
  @Input() cities: City[] = [];
  @Input() selectedCityId: number | null = null;
  @Input() userLocationCityId: number | null = null;

  @Output() select = new EventEmitter<number | null>();
  @Output() dismiss = new EventEmitter<void>();

  search = '';

  get visibleCities(): City[] {
    const q = this.search.trim().toLowerCase();
    if (!q) return this.cities;
    return this.cities.filter((c) => (c.name || '').toLowerCase().includes(q));
  }

  pick(cityId: number | null): void {
    this.select.emit(cityId);
  }

  onBackdrop(event: Event): void {
    if (event.target === event.currentTarget) {
      this.dismiss.emit();
    }
  }

  trackByCity(_: number, city: City): number {
    return city.id;
  }
}
