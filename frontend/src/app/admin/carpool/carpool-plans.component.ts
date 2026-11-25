import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { ButtonComponent, ColumnComponent, DataTableComponent, DrawerComponent, FilterSelectComponent, InputComponent, ModalComponent, StatusPillComponent } from '../../ui';
import type { FilterOption } from '../../ui';
import { CARPOOL_ADMIN_STYLES, inDate } from './carpool-admin.styles';

interface Plan {
  id: number; title: string; subtitle: string | null; amount: number; days_count: number; terms: string | null;
  city_id: number; city: string | null; available_from: string | null; available_to: string | null;
  is_active: boolean; on_sale_now: boolean; bought: number; running: number; waiting: number; group_size: number;
}

interface Form {
  title: string; subtitle: string; amount: number | null; days_count: number | null; terms: string;
  available_from: string; available_to: string; is_active: boolean; city_ids: number[]; all_cities: boolean; apply_to_group: boolean;
}

type Status = 'all' | 'on' | 'off';

/**
 * Carpool > Plans (Admin-Audit.md S-01): carpool plans only. A plan someone bought can't be deleted,
 * only turned off (drivers keep what they bought). City and audience never change after creation.
 * Payments themselves are not handled here.
 */
@Component({
  selector: 'app-carpool-plans',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent, ColumnComponent, DataTableComponent, DrawerComponent, FilterSelectComponent, InputComponent, ModalComponent, StatusPillComponent],
  template: `
    <div class="page">
      <div class="page__head">
        <header>
          <h1 class="page__title">Carpool plans</h1>
          <p class="page__sub">What carpool drivers can buy to publish carpools. Plans are priced per city, last a number of days, and take no commission. Edits apply to new purchases; drivers keep the price and days they bought.</p>
        </header>
        <tm-button *ngIf="canEdit" icon="plus" (clicked)="startNew()">New plan</tm-button>
      </div>

      <p class="notice notice--info" *ngIf="!canEdit">You can see plans but not change them. Changing plans needs the Carpool settings or Subscriptions permission.</p>

      <div class="tabs" role="tablist" aria-label="Which plans">
        <button *ngFor="let s of statuses" type="button" role="tab" [attr.aria-selected]="status === s.key" [class.is-on]="status === s.key" (click)="status = s.key; load()">{{ s.label }}</button>
      </div>

      <tm-data-table [rows]="rows" [total]="rows.length" [page]="1" [pageSize]="100" [pageSizes]="[100]" [loading]="loading"
        emptyTitle="No carpool plans" [emptyHint]="canEdit ? 'Create the first plan so carpool drivers can start publishing.' : 'Nothing matches these filters.'" (rowClick)="edit($event)">
        <tm-input slot="search" icon="search" placeholder="Plan name" [(ngModel)]="search" (ngModelChange)="onSearch()" />
        <ng-container slot="filters">
          <tm-filter-select icon="map-marker" ariaLabel="City" allLabel="All cities" allValue="" [options]="cityOptions" [value]="cityId" (valueChange)="cityId = $event; load()" />
        </ng-container>
        <tm-column key="title" label="Plan" [wrap]="true">
          <ng-template let-row><b class="pt">{{ row.title }}</b><span class="sub">{{ row.subtitle || '' }}</span></ng-template>
        </tm-column>
        <tm-column key="city" label="City" width="130px"><ng-template let-row>{{ row.city || '—' }}</ng-template></tm-column>
        <tm-column key="amount" label="Price" width="96px" align="right"><ng-template let-row>₹{{ row.amount | number:'1.0-2' }}</ng-template></tm-column>
        <tm-column key="days" label="Days" width="70px" align="right"><ng-template let-row>{{ row.days_count }}</ng-template></tm-column>
        <tm-column key="sale" label="On sale" width="200px" [wrap]="true">
          <ng-template let-row>{{ window(row) }}</ng-template>
        </tm-column>
        <tm-column key="drivers" label="Drivers" width="170px" [wrap]="true">
          <ng-template let-row>{{ row.running }} running<span class="sub">{{ row.waiting }} waiting · {{ row.bought }} bought in total</span></ng-template>
        </tm-column>
        <tm-column key="status" label="Status" width="120px">
          <ng-template let-row><tm-status-pill [tone]="row.on_sale_now ? 'success' : row.is_active ? 'warning' : 'neutral'">{{ statusLabel(row) }}</tm-status-pill></ng-template>
        </tm-column>
      </tm-data-table>
    </div>

    <tm-drawer [open]="drawer" [width]="560" [title]="editing ? 'Edit plan' : 'New plan'" [subtitle]="editing ? (editing.city || '') + ' · plan #' + editing.id : 'Carpool plan'" (closed)="drawer = false">
      <ng-container slot="body">
        <div class="form">
          <label class="field"><span>Name</span><input [(ngModel)]="f.title" maxlength="120" [disabled]="!canEdit" placeholder="For example: 30 days" /></label>
          <label class="field"><span>Short line under the name (optional)</span><input [(ngModel)]="f.subtitle" maxlength="191" [disabled]="!canEdit" placeholder="For example: Best for daily office trips" /></label>
          <div class="two">
            <label class="field"><span>Price (₹)</span><input type="number" min="1" max="100000" step="1" [(ngModel)]="f.amount" [disabled]="!canEdit" /></label>
            <label class="field"><span>Days it lasts</span><input type="number" min="1" max="365" step="1" [(ngModel)]="f.days_count" [disabled]="!canEdit" /></label>
          </div>
          <div class="two">
            <label class="field"><span>On sale from (optional)</span><input type="date" [(ngModel)]="f.available_from" [disabled]="!canEdit" /></label>
            <label class="field"><span>On sale until (optional)</span><input type="date" [(ngModel)]="f.available_to" [disabled]="!canEdit" /></label>
          </div>
          <span class="hint">Leave the dates empty to sell the plan for as long as it is on sale. Drivers who already bought it are not affected.</span>
          <label class="field"><span>Terms shown to drivers (optional)</span><textarea rows="4" maxlength="5000" [(ngModel)]="f.terms" [disabled]="!canEdit"></textarea></label>

          <fieldset class="field cities" *ngIf="!editing">
            <legend>Cities</legend>
            <label class="check"><input type="checkbox" [(ngModel)]="f.all_cities" /> All active cities ({{ activeCities().length }})</label>
            <ng-container *ngIf="!f.all_cities">
              <input class="cityq" type="search" [(ngModel)]="cityQuery" placeholder="Find a city" aria-label="Find a city" />
              <div class="citylist">
                <label class="check" *ngFor="let c of filteredCities()"><input type="checkbox" [checked]="f.city_ids.includes(c.id)" (change)="toggleCity(c.id)" /> {{ c.name }}<span class="tag" *ngIf="!c.is_active">inactive</span></label>
                <p class="muted" *ngIf="!filteredCities().length">No city matches.</p>
              </div>
              <span class="hint" *ngIf="f.city_ids.length">{{ f.city_ids.length }} {{ f.city_ids.length === 1 ? 'city' : 'cities' }} chosen</span>
            </ng-container>
            <span class="hint">One plan is created for each city, so each can later be priced on its own.</span>
          </fieldset>

          <label class="check" *ngIf="editing && editing.group_size > 1 && canEdit">
            <input type="checkbox" [(ngModel)]="f.apply_to_group" /> Apply to all {{ editing.group_size }} plans named "{{ editing.title }}" (one per city)
          </label>

          <div class="facts" *ngIf="editing">
            <div><b>{{ editing.running }}</b> drivers on this plan now</div>
            <div><b>{{ editing.waiting }}</b> waiting to start it</div>
            <div><b>{{ editing.bought }}</b> bought it in total</div>
          </div>

          <p class="err" *ngIf="error" role="alert">{{ error }}</p>
        </div>
      </ng-container>
      <ng-container slot="footer">
        <ng-container *ngIf="canEdit">
          <tm-button *ngIf="editing" variant="ghost" (clicked)="askToggle = true">{{ editing.is_active ? 'Take off sale' : 'Put on sale' }}</tm-button>
          <tm-button *ngIf="editing && editing.bought === 0" variant="ghost" (clicked)="askDelete = true">Delete</tm-button>
          <tm-button variant="ink" [loading]="busy" [disabled]="!valid()" (clicked)="save()">{{ editing ? 'Save changes' : 'Create plan' }}</tm-button>
        </ng-container>
      </ng-container>
    </tm-drawer>

    <tm-modal [open]="askToggle" [title]="editing?.is_active ? 'Take this plan off sale?' : 'Put this plan on sale?'" (closed)="askToggle = false">
      <ng-container slot="body">
        <p *ngIf="editing?.is_active">Drivers can no longer buy it. The {{ editing?.running }} drivers on it now and the {{ editing?.waiting }} waiting keep it until it ends.</p>
        <p *ngIf="!editing?.is_active">Drivers in {{ editing?.city }} can buy it again (within its on-sale dates, if set).</p>
        <label class="check" *ngIf="editing && editing.group_size > 1"><input type="checkbox" [(ngModel)]="toggleGroup" /> Do the same for all {{ editing.group_size }} plans named "{{ editing.title }}"</label>
      </ng-container>
      <ng-container slot="footer">
        <tm-button variant="ghost" (clicked)="askToggle = false">Back</tm-button>
        <tm-button variant="ink" [loading]="busy" (clicked)="toggle()">{{ editing?.is_active ? 'Take off sale' : 'Put on sale' }}</tm-button>
      </ng-container>
    </tm-modal>

    <tm-modal [open]="askDelete" title="Delete this plan?" (closed)="askDelete = false">
      <ng-container slot="body"><p>Nobody has bought it, so it can be deleted. This can't be undone.</p></ng-container>
      <ng-container slot="footer">
        <tm-button variant="ghost" (clicked)="askDelete = false">Back</tm-button>
        <tm-button variant="danger" [loading]="busy" (clicked)="remove()">Delete plan</tm-button>
      </ng-container>
    </tm-modal>
  `,
  styles: [CARPOOL_ADMIN_STYLES, `
    .sub { display: block; color: var(--tm-text-muted); font-size: 12px; }
    .pt { font-weight: 700; }
    .form { display: grid; gap: 14px; }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .hint { color: var(--tm-text-muted); font-size: 12px; margin-top: -6px; }
    .field input:disabled, .field textarea:disabled { background: var(--tm-canvas-2); color: var(--tm-text-muted); }
    .cities { border: 1px solid var(--tm-line-2); border-radius: var(--tm-radius-md); padding: 12px 14px; margin: 0; display: grid; gap: 8px; }
    .cities legend { padding: 0 6px; font-weight: 600; }
    .cities .hint { margin-top: 0; }
    .cityq { font: inherit; font-size: 13px; padding: 7px 10px; border: 1px solid var(--tm-line-2); border-radius: 8px; background: var(--tm-surface); color: var(--tm-text); }
    .citylist { max-height: 220px; overflow-y: auto; display: grid; gap: 8px; padding: 4px 2px; }
    .check { display: flex; gap: 8px; align-items: center; font-size: 13px; color: var(--tm-text); cursor: pointer; }
    .facts { display: flex; gap: 20px; flex-wrap: wrap; padding: 12px 14px; background: var(--tm-canvas-2); border-radius: var(--tm-radius-md); font-size: 13px; color: var(--tm-text-muted); }
    .facts b { color: var(--tm-text); font-size: 15px; }
    .err { margin: 0; color: var(--tm-danger); font-size: 13px; }
  `],
})
export class CarpoolPlansComponent implements OnInit {
  statuses: { key: Status; label: string }[] = [{ key: 'all', label: 'All plans' }, { key: 'on', label: 'On sale' }, { key: 'off', label: 'Off sale' }];
  status: Status = 'all';
  search = '';
  cityId = '';
  rows: Plan[] = [];
  cities: { id: number; name: string; is_active: boolean }[] = [];
  cityOptions: FilterOption[] = [];
  canEdit = false;
  loading = false;
  drawer = false;
  editing: Plan | null = null;
  f: Form = this.blank();
  busy = false;
  error = '';
  askToggle = false;
  askDelete = false;
  toggleGroup = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private api: ApiService, private toast: ToastService) {}

  ngOnInit(): void { this.load(); }

  onSearch(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.load(), 300);
  }

  load(): void {
    this.loading = true;
    const p = new URLSearchParams({ status: this.status });
    if (this.cityId) p.set('city_id', this.cityId);
    if (this.search.trim()) p.set('search', this.search.trim());
    this.api.get<{ data: Plan[]; cities: { id: number; name: string; is_active: boolean }[]; can_edit: boolean }>(`/admin/carpool/plans?${p}`).subscribe({
      next: (r) => {
        this.rows = r.data; this.cities = r.cities; this.canEdit = r.can_edit; this.loading = false;
        this.cityOptions = r.cities.map((c) => ({ label: c.name, value: String(c.id) }));
      },
      error: (e) => { this.loading = false; this.toast.error(e?.error?.message || 'Could not load plans.'); },
    });
  }

  private blank(): Form {
    return { title: '', subtitle: '', amount: null, days_count: 30, terms: '', available_from: '', available_to: '', is_active: true, city_ids: [], all_cities: false, apply_to_group: false };
  }

  cityQuery = '';

  activeCities() { return this.cities.filter((c) => c.is_active); }

  filteredCities() {
    const q = this.cityQuery.trim().toLowerCase();
    return q ? this.cities.filter((c) => c.name.toLowerCase().includes(q)) : this.cities;
  }

  startNew(): void {
    this.editing = null;
    this.f = this.blank();
    this.cityQuery = '';
    this.error = '';
    this.drawer = true;
  }

  edit(p: Plan): void {
    this.editing = p;
    this.f = {
      title: p.title, subtitle: p.subtitle ?? '', amount: p.amount, days_count: p.days_count, terms: p.terms ?? '',
      available_from: p.available_from ?? '', available_to: p.available_to ?? '', is_active: p.is_active,
      city_ids: [p.city_id], all_cities: false, apply_to_group: false,
    };
    this.error = '';
    this.toggleGroup = false;
    this.drawer = true;
  }

  toggleCity(id: number): void {
    this.f.city_ids = this.f.city_ids.includes(id) ? this.f.city_ids.filter((x) => x !== id) : [...this.f.city_ids, id];
  }

  valid(): boolean {
    const f = this.f;
    const okDates = !f.available_from || !f.available_to || f.available_to >= f.available_from;
    const okCities = !!this.editing || f.all_cities || f.city_ids.length > 0;
    return !!f.title.trim() && !!f.amount && f.amount >= 1 && !!f.days_count && f.days_count >= 1 && f.days_count <= 365 && okDates && okCities;
  }

  save(): void {
    const f = this.f;
    const body: Record<string, unknown> = {
      title: f.title.trim(), subtitle: f.subtitle.trim() || null, amount: f.amount, days_count: f.days_count, terms: f.terms.trim() || null,
      available_from: f.available_from || null, available_to: f.available_to || null,
    };
    this.busy = true;
    this.error = '';
    const call = this.editing
      ? this.api.patch<{ message: string }>(`/admin/carpool/plans/${this.editing.id}`, { ...body, apply_to_group: f.apply_to_group })
      : this.api.post<{ message: string }>('/admin/carpool/plans', { ...body, city_ids: f.all_cities ? ['all'] : f.city_ids });
    call.subscribe({
      next: (r) => { this.busy = false; this.drawer = false; this.toast.success(r.message); this.load(); },
      error: (e) => { this.busy = false; this.error = this.err(e); },
    });
  }

  toggle(): void {
    if (!this.editing) return;
    this.busy = true;
    this.api.post<{ message: string }>(`/admin/carpool/plans/${this.editing.id}/active`, { active: !this.editing.is_active, apply_to_group: this.toggleGroup }).subscribe({
      next: (r) => { this.busy = false; this.askToggle = false; this.drawer = false; this.toast.success(r.message); this.load(); },
      error: (e) => { this.busy = false; this.askToggle = false; this.toast.error(this.err(e)); },
    });
  }

  remove(): void {
    if (!this.editing) return;
    this.busy = true;
    this.api.delete<{ message: string }>(`/admin/carpool/plans/${this.editing.id}`).subscribe({
      next: (r) => { this.busy = false; this.askDelete = false; this.drawer = false; this.toast.success(r.message); this.load(); },
      error: (e) => { this.busy = false; this.askDelete = false; this.toast.error(this.err(e)); },
    });
  }

  private err(e: any): string {
    const errs = e?.error?.errors;
    if (errs) { const first = Object.values(errs)[0] as string[]; if (first?.length) return first[0]; }
    return e?.error?.message || 'That did not work. Try again.';
  }

  window(p: Plan): string {
    if (!p.available_from && !p.available_to) return p.is_active ? 'No date limits' : '—';
    return (p.available_from ? inDate(p.available_from + 'T00:00:00+05:30') : 'Now') + ' to ' + (p.available_to ? inDate(p.available_to + 'T00:00:00+05:30') : 'no end');
  }

  statusLabel(p: Plan): string {
    if (!p.is_active) return 'Off sale';
    return p.on_sale_now ? 'On sale' : 'Outside sale dates';
  }
}
