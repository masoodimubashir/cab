import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { CityContextService } from '../../core/city-context.service';
import { ToastService } from '../../core/toast.service';
import { VehicleSeatLayout, VehicleSeatLayoutsService } from './vehicle-seat-layouts.service';
import { SeatGridComponent } from './seat-grid.component';
import { ReturnToSetupComponent } from '../setup/return-to-setup.component';

/**
 * Admin list of reusable seat layouts for the selected city. Each row shows
 * a compact preview + seat count + in-use badge. In-use layouts can't be
 * deleted (server enforces; we mirror the guard in the UI).
 */
@Component({
  selector: 'app-seat-layout-list',
  standalone: true,
  imports: [CommonModule, RouterLink, SeatGridComponent, ReturnToSetupComponent],
  template: `
    <app-return-to-setup></app-return-to-setup>
    <div class="cue" *ngIf="cityId == null">Select a city (top bar) to manage seat layouts.</div>

    <ng-container *ngIf="cityId != null">
      <header class="head">
        <div>
          <h1 class="head__title">Seat Layouts</h1>
          <p class="head__sub">Design the seat map operators show customers when they book a fixed departure.</p>
        </div>
        <a class="btn btn--primary" routerLink="/vehicle-seat-layouts/new">+ New layout</a>
      </header>

      <div class="loading" *ngIf="loading">Loading layouts…</div>

      <div class="empty" *ngIf="!loading && !layouts.length">
        <div class="empty__ic">🪑</div>
        <div class="empty__t">No seat layouts yet</div>
        <div class="empty__s">Create your first layout — e.g. an Ertiga 6-seater with a driver-blocked front row.</div>
        <a class="btn btn--primary" routerLink="/vehicle-seat-layouts/new">Design a layout</a>
      </div>

      <div class="grid" *ngIf="!loading && layouts.length">
        <article class="card" *ngFor="let l of layouts">
          <header class="card__head">
            <div>
              <h3 class="card__title">{{ l.name }}</h3>
              <div class="card__meta">
                <span>{{ l.rows }} × {{ l.cols }}</span>
                <span>·</span>
                <span>{{ l.seat_count }} seat{{ l.seat_count === 1 ? '' : 's' }}</span>
              </div>
            </div>
            <div class="card__badges">
              <span class="badge badge--muted" *ngIf="!l.is_active">Inactive</span>
              <span class="badge badge--in-use" *ngIf="l.in_use">In use</span>
            </div>
          </header>

          <div class="card__preview">
            <app-seat-grid
              [rows]="l.rows"
              [cols]="l.cols"
              [cells]="l.cells"
              [showLegend]="false"
              [showWheel]="false"
            />
          </div>

          <footer class="card__foot">
            <a class="btn btn--ghost" [routerLink]="['/vehicle-seat-layouts', l.id]">Edit</a>
            <button
              class="btn btn--danger"
              [disabled]="l.in_use"
              [title]="l.in_use ? 'Layout is used by an existing departure' : ''"
              (click)="remove(l)"
            >Delete</button>
          </footer>
        </article>
      </div>
    </ng-container>
  `,
  styles: [`
    .cue { padding: 20px; color: var(--tm-text-muted); font-size: 13px; }
    .head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
    .head__title { margin: 0; font-size: 22px; font-weight: 800; color: var(--tm-text); }
    .head__sub { margin: 4px 0 0; font-size: 13px; color: var(--tm-text-muted); }
    .btn { display: inline-flex; align-items: center; justify-content: center; padding: 9px 14px; border-radius: 9px; font-weight: 700; font-size: 13px; cursor: pointer; border: 1px solid transparent; text-decoration: none; }
    .btn[disabled] { opacity: .5; cursor: not-allowed; }
    .btn--primary { background: var(--tm-green, #12b35b); color: #fff; border-color: var(--tm-green, #12b35b); }
    .btn--ghost { background: #fff; color: var(--tm-text); border-color: var(--tm-line); }
    .btn--ghost:hover { border-color: #12b35b; color: #12b35b; }
    .btn--danger { background: #fff; color: #c0392b; border-color: #f1c7c1; }
    .btn--danger:not([disabled]):hover { background: #fdecea; }
    .loading { padding: 40px; text-align: center; color: var(--tm-text-muted); }
    .empty { padding: 48px 24px; text-align: center; border: 1px dashed var(--tm-line); border-radius: 12px; background: #fafbfc; }
    .empty__ic { font-size: 36px; margin-bottom: 8px; }
    .empty__t { font-size: 16px; font-weight: 800; color: var(--tm-text); }
    .empty__s { font-size: 13px; color: var(--tm-text-muted); margin: 4px 0 16px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
    .card { background: #fff; border: 1px solid #eaeef2; border-radius: 14px; padding: 16px; display: flex; flex-direction: column; gap: 12px; box-shadow: 0 1px 3px rgba(0,0,0,.04); }
    .card__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
    .card__title { margin: 0; font-size: 15px; font-weight: 800; color: var(--tm-text); }
    .card__meta { font-size: 12px; color: var(--tm-text-muted); display: flex; gap: 6px; margin-top: 2px; }
    .card__badges { display: flex; gap: 6px; }
    .badge { font-size: 10px; font-weight: 800; padding: 3px 8px; border-radius: 999px; }
    .badge--muted { background: #f2f4f6; color: #6b7280; }
    .badge--in-use { background: #fef3c7; color: #92400e; }
    .card__preview { padding: 6px; background: #fafbfc; border-radius: 10px; }
    .card__foot { display: flex; gap: 8px; justify-content: flex-end; }
  `],
})
export class SeatLayoutListComponent implements OnInit, OnDestroy {
  cityId: number | null = null;
  layouts: VehicleSeatLayout[] = [];
  loading = false;
  private sub?: Subscription;

  constructor(
    private cityCtx: CityContextService,
    private svc: VehicleSeatLayoutsService,
    private toast: ToastService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.cityCtx.ensureCitiesLoaded().subscribe();
    this.sub = this.cityCtx.cityId$.subscribe((id) => {
      this.cityId = id;
      if (id != null) this.load();
      else this.layouts = [];
    });
  }
  ngOnDestroy(): void { this.sub?.unsubscribe(); }

  load(): void {
    if (this.cityId == null) return;
    this.loading = true;
    this.svc.list(this.cityId).subscribe({
      next: (res) => { this.layouts = res?.data || []; this.loading = false; },
      error: (e) => { this.toast.error(e?.error?.message || 'Could not load layouts.'); this.loading = false; },
    });
  }

  remove(l: VehicleSeatLayout): void {
    if (this.cityId == null || l.in_use) return;
    if (!confirm(`Delete "${l.name}"? This cannot be undone.`)) return;
    this.svc.destroy(this.cityId, l.id).subscribe({
      next: () => { this.toast.success('Layout deleted.'); this.load(); },
      error: (e) => { this.toast.error(e?.error?.message || 'Could not delete layout.'); },
    });
  }
}
