import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';

interface GroupOpt { id: number; name: string; city_id?: number; city_name?: string; is_active: boolean; }
interface EffRoute { id: number; name: string; origin_name: string; dest_name: string; scope: string; is_active: boolean; }
interface Payload { assigned_group_ids: number[]; groups: GroupOpt[]; effective_routes: EffRoute[]; }

/**
 * Driver page panel: assign route groups to this driver and show the resolved
 * "effective routes" (the union of the routes in the groups they hold). This is
 * how a driver's fixed-route access is set — independent of their vehicle.
 */
@Component({
  selector: 'app-driver-route-groups-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="drg">
      <header class="drg__head">
        <h3>Fixed route access</h3>
        <span class="drg__sub">Routes are granted by route groups across this driver's registered operating cities.</span>
      </header>

      <div class="drg__body">
        <div class="drg__col">
          <div class="drg__label">Route groups</div>
          <div class="drg__empty" *ngIf="!groups.length">No route groups found in this driver's cities yet.</div>
          <label class="drg__grp" *ngFor="let g of groups">
            <input type="checkbox" [checked]="assigned.has(g.id)" (change)="toggle(g.id)" />
            <span>
              <strong>{{ g.name }}</strong>
              <small class="drg__city" *ngIf="g.city_name">· {{ g.city_name }}</small>
            </span>
          </label>
          <button class="drg__save" [disabled]="saving || !driverId" (click)="save()">{{ saving ? 'Saving…' : 'Save route groups' }}</button>
        </div>

        <div class="drg__col">
          <div class="drg__label">Effective routes ({{ effective.length }})</div>
          <div class="drg__empty" *ngIf="!effective.length">No routes — assign a group to give this driver work.</div>
          <div class="drg__route" *ngFor="let r of effective">
            <strong>{{ r.name }}</strong>
            <small>{{ r.origin_name }} → {{ r.dest_name }} · {{ r.scope }}</small>
          </div>
        </div>
      </div>
    </section>
  `,
  styles: [`
    .drg { border: 1px solid var(--tm-line); border-radius: 12px; padding: 14px; margin-top: 16px; }
    .drg__head { display: flex; flex-direction: column; gap: 2px; margin-bottom: 12px; }
    .drg__head h3 { margin: 0; font-size: 15px; font-weight: 800; color: var(--tm-text); }
    .drg__sub { font-size: 12px; color: var(--tm-text-muted); }
    .drg__body { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    @media (max-width: 640px) { .drg__body { grid-template-columns: 1fr; } }
    .drg__label { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .03em; color: var(--tm-text-muted); margin-bottom: 8px; }
    .drg__grp { display: flex; align-items: center; gap: 8px; padding: 5px 0; font-size: 13px; color: var(--tm-text); cursor: pointer; }
    .drg__city { font-size: 11.5px; color: var(--tm-text-muted); font-weight: 600; margin-left: 4px; }
    .drg__save { margin-top: 10px; padding: 8px 14px; border: 0; border-radius: 8px; background: var(--tm-green, #12b35b); color: #fff; font-weight: 700; font-size: 12.5px; cursor: pointer; }
    .drg__save:disabled { opacity: .5; cursor: default; }
    .drg__route { padding: 7px 10px; border: 1px solid var(--tm-line); border-radius: 8px; margin-bottom: 6px; display: flex; flex-direction: column; gap: 2px; }
    .drg__route strong { font-size: 13px; color: var(--tm-text); }
    .drg__route small { font-size: 11.5px; color: var(--tm-text-muted); }
    .drg__empty { font-size: 12.5px; color: var(--tm-text-muted); padding: 6px 0; }
  `],
})
export class DriverRouteGroupsPanelComponent implements OnChanges {
  @Input() driverId!: number;

  groups: GroupOpt[] = [];
  effective: EffRoute[] = [];
  assigned = new Set<number>();
  saving = false;

  constructor(private api: ApiService, private toast: ToastService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['driverId'] && this.driverId) this.load();
  }

  load(): void {
    this.api.get<Payload>(`/admin/drivers/${this.driverId}/route-groups`).subscribe({
      next: (res) => {
        this.groups = res?.groups || [];
        this.effective = res?.effective_routes || [];
        this.assigned = new Set<number>(res?.assigned_group_ids || []);
      },
      error: () => { this.groups = []; this.effective = []; this.assigned = new Set(); },
    });
  }

  toggle(id: number): void {
    if (this.assigned.has(id)) this.assigned.delete(id);
    else this.assigned.add(id);
  }

  save(): void {
    if (!this.driverId) return;
    this.saving = true;
    this.api.put<Payload>(`/admin/drivers/${this.driverId}/route-groups`, { group_ids: Array.from(this.assigned) }).subscribe({
      next: (res) => {
        this.saving = false;
        this.effective = res?.effective_routes || [];
        this.assigned = new Set<number>(res?.assigned_group_ids || []);
        this.toast.success('Route groups updated.');
      },
      error: (e) => { this.saving = false; this.toast.error(e?.error?.message || 'Could not update route groups.'); },
    });
  }
}
