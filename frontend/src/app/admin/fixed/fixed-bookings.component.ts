import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { Subject, catchError, map, of, startWith, switchMap } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { CityContextService } from '../../core/city-context.service';
import { ColumnComponent, DataTableComponent } from '../../ui';

interface SeatBooking {
  id: number;
  route_name: string | null;
  customer_name: string | null;
  seats: number;
  status: string;
  payment_status: string;
  service_date: string | null;
  fare_amount: number | null;
  trip_id: number | null;
}

@Component({
  selector: 'app-fixed-bookings',
  standalone: true,
  imports: [CommonModule, RouterLink, ColumnComponent, DataTableComponent],
  template: `
    @if (result(); as data) {
      @if (data.error) {
        <p role="status">{{ data.error }}
          @if (city.currentCityId) { <button type="button" (click)="refresh()">Retry</button> }
        </p>
      } @else {
        <tm-data-table [rows]="data.rows" [total]="data.total" [page]="page()" [pageSize]="pageSize()" (pageSizeChange)="resize($event)"
          [loading]="data.loading" emptyTitle="No seat bookings found" (pageChange)="selectPage($event)">
          <form slot="search" (submit)="$event.preventDefault(); search(term.value)">
            <input #term type="search" maxlength="120" aria-label="Search seat bookings" placeholder="Booking, route or customer" />
            <button>Search</button>
          </form>
          <tm-column key="id" label="Booking"><ng-template let-row>#{{ row.id }}</ng-template></tm-column>
          <tm-column key="customer_name" label="Customer" />
          <tm-column key="route_name" label="Route" />
          <tm-column key="service_date" label="Ride date" />
          <tm-column key="seats" label="Seats" />
          <tm-column key="fare_amount" label="Fare"><ng-template let-row>{{ row.fare_amount | currency:'INR' }}</ng-template></tm-column>
          <tm-column key="status" label="Status" />
          <tm-column key="payment_status" label="Payment" />
          <tm-column key="trip_id" label="Trip"><ng-template let-row>
            @if (row.trip_id) { <a [routerLink]="['/rides', row.trip_id]">#{{ row.trip_id }}</a> } @else { — }
          </ng-template></tm-column>
        </tm-data-table>
      }
    }
  `,
  styles: [`
    form { display:flex; gap:8px; }
    input, button { font:inherit; padding:8px; border:1px solid var(--tm-line); border-radius:6px; background:var(--tm-surface); }
    button { cursor:pointer; }
  `],
})
export class FixedBookingsComponent {
  readonly city = inject(CityContextService);
  private readonly api = inject(ApiService);
  private readonly updates = new Subject<void>();
  readonly page = signal(1);
  readonly pageSize = signal(25);
  private term = '';
  readonly result = toSignal(this.city.cityId$.pipe(switchMap(cityId => {
    this.page.set(1);
    const empty = { rows: [] as SeatBooking[], total: 0, loading: false, error: '' };
    if (!cityId) return of({ ...empty, error: 'Select a city to view seat bookings.' });
    return this.updates.pipe(startWith(undefined), switchMap(() => {
      const query = new URLSearchParams({page: String(this.page()), per_page: String(this.pageSize()), q: this.term});
      return this.api.get<{data: {data: SeatBooking[]; total: number}}>(`/admin/cities/${cityId}/fixed-bookings?${query}`).pipe(
        map(res => ({...empty, rows: res.data.data, total: res.data.total})),
        startWith({...empty, loading: true}),
        catchError(() => of({...empty, error: 'Could not load seat bookings.'})),
      );
    }));
  })));

  resize(size: number): void { this.pageSize.set(size); this.selectPage(1); }
  selectPage(page: number): void { this.page.set(page); this.refresh(); }
  search(term: string): void { this.term = term.trim(); this.selectPage(1); }
  refresh(): void { this.updates.next(); }
}
