import { ChangeDetectionStrategy, ChangeDetectorRef, Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { PlacesService } from '../../core/places.service';
import { GeolocationService } from '../../core/geolocation.service';
import { BookingService } from './booking.service';
import { Place } from './booking.models';

/**
 * The shared "pick a place" content — a search field, live suggestions,
 * "use my current location" and saved places.
 *
 * Every flow needs a pickup and a drop, and they should look and behave the
 * same in all three, so this is one component the pickup and drop steps drop
 * into their StepShell body. It only emits the chosen place; the flow decides
 * what to do next.
 */
@Component({
  selector: 'app-place-search',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule],
  // Icons are inline SVG (not ion-icon) so this standalone component needs no
  // web-component schema and can't trip AOT element checking.
  template: `
    <label class="ps-field bk-field" [class.bk-field--on]="query.length > 0">
      <svg class="ps-ic" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/>
        <path d="m20 20-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <input
        class="bk-field__input"
        type="search"
        [placeholder]="placeholder"
        autocomplete="off"
        [(ngModel)]="query"
        (ngModelChange)="onQuery($event)" />
      <button *ngIf="query" class="ps-clear" type="button" aria-label="Clear" (click)="clear()">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>
    </label>

    <p class="bk-sub" *ngIf="searching">Looking…</p>

    <!-- Suggestions from Google. -->
    <button
      *ngFor="let s of suggestions; trackBy: trackBySuggestion"
      class="bk-opt ps-row"
      type="button"
      (click)="choose(s.place_id)">
      <span class="bk-opt__ic">
        <svg class="ps-svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11Z" stroke="currentColor" stroke-width="2"/>
          <circle cx="12" cy="10" r="2.4" stroke="currentColor" stroke-width="2"/>
        </svg>
      </span>
      <span class="bk-opt__main">
        <span class="bk-opt__t">{{ s.main_text }}</span>
        <span class="bk-opt__s">{{ s.secondary_text }}</span>
      </span>
    </button>

    <!-- Shortcuts, shown only when the rider hasn't started typing. -->
    <ng-container *ngIf="!query && !suggestions.length">
      <button class="bk-opt ps-row" type="button" (click)="useCurrent()" [disabled]="locating">
        <span class="bk-opt__ic">
          <svg class="ps-svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="2"/>
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </span>
        <span class="bk-opt__main">
          <span class="bk-opt__t">{{ locating ? 'Finding you…' : 'Use my current location' }}</span>
        </span>
      </button>

      <button
        *ngFor="let p of saved; trackBy: trackBySaved"
        class="bk-opt ps-row"
        type="button"
        (click)="pick(p)">
        <span class="bk-opt__ic">
          <svg class="ps-svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 17l-5.3 2.6 1-5.8L3.5 9.7l5.9-.9L12 3.5Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
          </svg>
        </span>
        <span class="bk-opt__main">
          <span class="bk-opt__t">{{ p.label || 'Saved place' }}</span>
          <span class="bk-opt__s">{{ p.address }}</span>
        </span>
      </button>
    </ng-container>

    <p class="bk-note bk-note--warn" *ngIf="error">{{ error }}</p>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; gap: 10px; }
    .ps-ic { flex: none; width: 20px; height: 20px; color: var(--dc-ink-faint); }
    .ps-clear { flex: none; width: 28px; height: 28px; padding: 4px; border: 0; background: transparent; color: var(--dc-ink-faint); display: flex; align-items: center; justify-content: center; }
    .ps-clear svg { width: 18px; height: 18px; }
    .ps-svg { width: 20px; height: 20px; color: var(--dc-green); }
    .ps-row { width: 100%; }
  `],
})
export class PlaceSearchComponent implements OnInit {
  /** 'pickup' tints the current-location shortcut as the obvious default. */
  @Input() placeholder = 'Search a place or address';
  /** Bias autocomplete toward here (usually the pickup). */
  @Input() near?: { lat: number; lng: number };

  @Output() picked = new EventEmitter<Place>();

  query = '';
  suggestions: { place_id: string; main_text: string; secondary_text: string }[] = [];
  saved: Place[] = [];
  searching = false;
  locating = false;
  error: string | null = null;

  private debounce: ReturnType<typeof setTimeout> | null = null;
  /** Guards against a slow earlier request overwriting a newer one. */
  private seq = 0;

  constructor(
    private places: PlacesService,
    private geo: GeolocationService,
    private booking: BookingService,
    private cdr: ChangeDetectorRef,
  ) {}

  async ngOnInit(): Promise<void> {
    try {
      const res = await this.booking.savedPlaces();
      this.saved = (res?.data ?? []).map((row: any) => ({
        lat: Number(row.lat),
        lng: Number(row.lng),
        address: row.address,
        label: row.label,
      }));
    } catch {
      this.saved = [];
    }
    this.cdr.markForCheck();
  }

  onQuery(value: string): void {
    this.query = value;
    this.error = null;
    if (this.debounce) clearTimeout(this.debounce);

    if (!value || value.trim().length < 2) {
      this.suggestions = [];
      this.searching = false;
      this.cdr.markForCheck();
      return;
    }

    this.searching = true;
    this.cdr.markForCheck();

    // 260 ms after the last keystroke — long enough not to fire on every
    // letter, short enough to feel live.
    this.debounce = setTimeout(() => void this.run(value), 260);
  }

  clear(): void {
    this.query = '';
    this.suggestions = [];
    this.searching = false;
    this.cdr.markForCheck();
  }

  async choose(placeId: string): Promise<void> {
    this.error = null;
    const detail = await this.places.getPlaceDetail(placeId);
    if (!detail) {
      this.error = 'Couldn\'t load that place. Try another.';
      this.cdr.markForCheck();
      return;
    }
    this.picked.emit({ lat: detail.lat, lng: detail.lng, address: detail.description });
  }

  pick(place: Place): void {
    this.picked.emit(place);
  }

  async useCurrent(): Promise<void> {
    this.locating = true;
    this.error = null;
    this.cdr.markForCheck();
    try {
      const fix = await this.geo.getCurrentPosition();
      if (!fix) throw new Error('no fix');
      const address = (await this.places.reverseGeocode(fix.lat, fix.lng)) ?? 'Current location';
      this.picked.emit({ lat: fix.lat, lng: fix.lng, address });
    } catch {
      this.error = 'We couldn\'t get your location. Search for it instead.';
    } finally {
      this.locating = false;
      this.cdr.markForCheck();
    }
  }

  trackBySuggestion = (_: number, s: { place_id: string }): string => s.place_id;
  trackBySaved = (_: number, p: Place): string => p.label ?? p.address;

  private async run(value: string): Promise<void> {
    const mine = ++this.seq;
    try {
      const results = await this.places.autocompleteSearch(value, this.near);
      if (mine !== this.seq) return; // a newer query already answered
      this.suggestions = results;
    } catch {
      this.suggestions = [];
    } finally {
      if (mine === this.seq) this.searching = false;
      this.cdr.markForCheck();
    }
  }
}
